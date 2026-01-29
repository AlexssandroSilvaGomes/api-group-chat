import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userRooms = new Map<string, string>();

  constructor(private readonly chatService: ChatService) { }

  handleConnection(client: Socket) {
    client.emit('connected', {
      userId: client.id,
    });

    client.emit('room_list', this.chatService.getRooms());
  }

  handleDisconnect(client: Socket) {
    const currentRoom = this.userRooms.get(client.id);
    if (currentRoom) {
      this.chatService.removeUserFromRoom(currentRoom, client.id);
      client.leave(currentRoom);

      const room = this.chatService.getRoom(currentRoom);
      this.server.to(currentRoom).emit('room_users', {
        roomId: currentRoom,
        users: room
          ? Array.from(room.users.values()).map(u => ({ id: u.id, name: u.name }))
          : [],
      });
    }
  }

  @SubscribeMessage('set_user_name')
  handleSetUserName(client: Socket, userName: string) {
    this.chatService.setUserName(client.id, userName);

    const currentRoom = this.userRooms.get(client.id);
    if (currentRoom) {
      const room = this.chatService.getRoom(currentRoom);
      this.server.to(currentRoom).emit('room_users', {
        roomId: currentRoom,
        users: room
          ? Array.from(room.users.values()).map(u => ({ id: u.id, name: u.name }))
          : [],
      });
    }
  }

  @SubscribeMessage('create_room')
  handleCreateRoom(client: Socket, data: { roomName: string; isPrivate?: boolean; password?: string }) {
    const { roomName, isPrivate = false, password } = data;
    this.chatService.createRoom(roomName, client.id, isPrivate, password);

    if (isPrivate) {
      this.chatService.addUserToPrivateRoom(roomName, client.id);
    }

    this.server.emit('room_created', {
      roomId: roomName,
      isPrivate,
      creatorId: client.id,
    });
  }

  @SubscribeMessage('get_rooms')
  handleGetRooms(client: Socket) {
    const allRooms = this.chatService.getRooms();
    const accessibleRooms = allRooms.filter(roomId =>
      this.chatService.canAccessRoom(roomId, client.id)
    );
    client.emit('room_list', accessibleRooms);
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(client: Socket, data: { roomId: string; password?: string }) {
    const { roomId, password } = data;

    const room = this.chatService.getRoom(roomId);
    if (!room) {
      client.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.isPrivate && !this.chatService.canAccessRoom(roomId, client.id)) {
      if (password && this.chatService.verifyRoomPassword(roomId, password)) {
        this.chatService.addUserToPrivateRoom(roomId, client.id);
      } else {
        client.emit('error', { message: 'Unauthorized' });
        return;
      }
    }

    this.chatService.addUserToRoom(roomId, client.id);
    client.join(roomId);

    const updatedRoom = this.chatService.getRoom(roomId);
    const creatorId = this.chatService.getRoomCreator(roomId);

    this.server.to(roomId).emit('room_users', {
      roomId,
      users: updatedRoom
        ? Array.from(updatedRoom.users.values()).map(u => ({ id: u.id, name: u.name }))
        : [],
      creatorId,
    });
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(client: Socket, roomId: string) {
    this.chatService.removeUserFromRoom(roomId, client.id);
    client.leave(roomId);
    this.userRooms.delete(client.id);

    const room = this.chatService.getRoom(roomId);
    const creatorId = this.chatService.getRoomCreator(roomId);

    this.server.to(roomId).emit('room_users', {
      roomId,
      users: room
        ? Array.from(room.users.values()).map(u => ({ id: u.id, name: u.name }))
        : [],
      creatorId,
    });
  }

  @SubscribeMessage('send_message')
  handleSendMessage(
    client: Socket,
    payload: { roomId: string; message: string },
  ) {
    const userName = this.chatService.getUserName(client.id);
    const message = {
      userId: client.id,
      userName,
      message: payload.message,
      timestamp: new Date(),
    };

    this.chatService.addMessage(payload.roomId, message);

    this.server.to(payload.roomId).emit('new_message', message);
  }

  @SubscribeMessage('add_user_to_private_room')
  handleAddUserToPrivateRoom(client: Socket, data: { roomId: string; userId: string }) {
    const { roomId, userId } = data;
    const room = this.chatService.getRoom(roomId);

    if (!room || !room.isPrivate) {
      client.emit('error', { message: 'Invalid room' });
      return;
    }

    this.chatService.addUserToPrivateRoom(roomId, userId);
    this.server.emit('room_list_updated');
  }

  @SubscribeMessage('remove_room')
  handleRemoveRoom(client: Socket, roomId: string) {
    if (!this.chatService.isRoomCreator(roomId, client.id)) {
      client.emit('error', { message: 'Apenas o criador pode deletar a sala' });
      return;
    }

    this.chatService.removeRoom(roomId);
    this.server.emit('room_removed', roomId);
  }

  @SubscribeMessage('remove_user_from_room')
  handleRemoveUserFromRoom(client: Socket, data: { roomId: string; userId: string }) {
    const { roomId, userId } = data;

    if (!this.chatService.isRoomCreator(roomId, client.id)) {
      client.emit('error', { message: 'Apenas o criador pode remover usuários' });
      return;
    }

    this.chatService.removeUserFromRoom(roomId, userId);
    const user = this.server.sockets.sockets.get(userId);
    if (user) {
      user.leave(roomId);
      user.emit('removed_from_room', roomId);
    }

    const room = this.chatService.getRoom(roomId);
    const creatorId = this.chatService.getRoomCreator(roomId);

    this.server.to(roomId).emit('room_users', {
      roomId,
      users: room
        ? Array.from(room.users.values()).map(u => ({ id: u.id, name: u.name }))
        : [],
      creatorId,
    });
  }
}
