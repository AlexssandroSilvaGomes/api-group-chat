import { Injectable } from '@nestjs/common';

interface Message {
  userId: string;
  userName: string;
  message: string;
  timestamp: Date;
}

interface RoomUser {
  id: string;
  name: string;
}

interface Room {
  users: Map<string, RoomUser>;
  messages: Message[];
  isPrivate: boolean;
  password?: string;
  allowedUsers?: Set<string>;
  creatorId: string;
}

@Injectable()
export class ChatService {
  private rooms = new Map<string, Room>();
  private userNames = new Map<string, string>();

  createRoom(roomId: string, creatorId: string, isPrivate = false, password?: string) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        users: new Map(),
        messages: [],
        isPrivate,
        password,
        allowedUsers: new Set(),
        creatorId,
      });
    }
  }

  setUserName(userId: string, userName: string) {
    this.userNames.set(userId, userName);
  }

  getUserName(userId: string) {
    return this.userNames.get(userId) || `User ${userId.slice(0, 6)}`;
  }

  removeRoom(roomId: string) {
    this.rooms.delete(roomId);
  }

  addUserToRoom(roomId: string, userId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const userName = this.getUserName(userId);
    room.users.set(userId, { id: userId, name: userName });
  }

  removeUserFromRoom(roomId: string, userId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.users.delete(userId);
  }

  addMessage(roomId: string, message: Message) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.messages.push(message);
  }

  getRoom(roomId: string) {
    return this.rooms.get(roomId);
  }

  getRooms() {
    return [...this.rooms.keys()];
  }

  getRoomsByUserId(userId: string) {
    return [...this.rooms.entries()]
      .filter(([_, room]) => room.users.has(userId))
      .map(([roomId]) => roomId);
  }

  addUserToPrivateRoom(roomId: string, userId: string) {
    const room = this.rooms.get(roomId);
    if (!room || !room.isPrivate) return false;

    room.allowedUsers?.add(userId);
    return true;
  }

  canAccessRoom(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (!room.isPrivate) return true;
    return room.allowedUsers?.has(userId) ?? false;
  }

  verifyRoomPassword(roomId: string, password: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.isPrivate) return false;
    return room.password === password;
  }

  isRoomCreator(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.creatorId === userId;
  }

  getRoomCreator(roomId: string): string | null {
    const room = this.rooms.get(roomId);
    return room?.creatorId ?? null;
  }
}
