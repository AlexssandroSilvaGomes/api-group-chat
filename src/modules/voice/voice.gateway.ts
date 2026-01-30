import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { VoiceService } from './voice.service';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
    cors: { origin: '*' },
})
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(VoiceGateway.name);
    private userVoiceRooms = new Map<string, string>(); // userId -> roomId

    constructor(private readonly voiceService: VoiceService) { }

    handleConnection(client: Socket) {
        this.logger.log(`🔌 Cliente conectado: ${client.id}`);
    }

    async handleDisconnect(client: Socket) {
        this.logger.log(`🔌 Cliente desconectado: ${client.id}`);

        // Remover usuário de qualquer canal de voz
        const roomId = this.userVoiceRooms.get(client.id);
        if (roomId) {
            await this.voiceService.leaveVoiceChannel(roomId, client.id);
            this.userVoiceRooms.delete(client.id);

            // Notificar outros usuários
            this.server.to(roomId).emit('voice_user_left', {
                userId: client.id,
                roomId,
            });
        }
    }

    /**
     * Entrar em um canal de voz
     */
    @SubscribeMessage('join_voice_channel')
    async handleJoinVoiceChannel(
        client: Socket,
        payload: { roomId: string; userName: string },
    ) {
        try {
            const { roomId, userName } = payload;

            const result = await this.voiceService.joinVoiceChannel(
                roomId,
                client.id,
                userName,
            );

            this.userVoiceRooms.set(client.id, roomId);
            client.join(`voice_${roomId}`);

            // Notificar todos na sala
            this.server.to(`voice_${roomId}`).emit('voice_users_updated', {
                roomId,
                users: result.users,
            });

            client.emit('joined_voice_channel', {
                roomId,
                users: result.users,
            });

            this.logger.log(`🎙️ Usuário ${userName} entrou no canal de voz: ${roomId}`);
        } catch (error) {
            this.logger.error(`Erro ao entrar no canal de voz: ${error.message}`);
            client.emit('voice_error', { message: error.message });
        }
    }

    /**
     * Sair de um canal de voz
     */
    @SubscribeMessage('leave_voice_channel')
    async handleLeaveVoiceChannel(client: Socket, payload: { roomId: string }) {
        try {
            const { roomId } = payload;

            await this.voiceService.leaveVoiceChannel(roomId, client.id);
            this.userVoiceRooms.delete(client.id);
            client.leave(`voice_${roomId}`);

            // Notificar outros usuários
            this.server.to(`voice_${roomId}`).emit('voice_user_left', {
                userId: client.id,
                roomId,
            });

            // Atualizar lista de usuários
            const users = this.voiceService.getVoiceUsers(roomId);
            this.server.to(`voice_${roomId}`).emit('voice_users_updated', {
                roomId,
                users,
            });

            client.emit('left_voice_channel', { roomId });

            this.logger.log(`👋 Usuário ${client.id} saiu do canal de voz: ${roomId}`);
        } catch (error) {
            this.logger.error(`Erro ao sair do canal de voz: ${error.message}`);
            client.emit('voice_error', { message: error.message });
        }
    }

    /**
     * Toggle Mute/Unmute
     */
    @SubscribeMessage('toggle_mute')
    async handleToggleMute(
        client: Socket,
        payload: { roomId: string; isMuted: boolean },
    ) {
        try {
            const { roomId, isMuted } = payload;

            await this.voiceService.toggleMute(roomId, client.id, isMuted);

            // Notificar todos na sala
            this.server.to(`voice_${roomId}`).emit('user_mute_changed', {
                userId: client.id,
                isMuted,
                roomId,
            });

            client.emit('mute_toggled', { isMuted });

            this.logger.log(`🔇 Usuário ${client.id} ${isMuted ? 'mutado' : 'desmutado'}`);
        } catch (error) {
            this.logger.error(`Erro ao mutar/desmutar: ${error.message}`);
            client.emit('voice_error', { message: error.message });
        }
    }

    /**
     * Obter RTP Capabilities do Router
     */
    @SubscribeMessage('get_router_rtp_capabilities')
    async handleGetRouterRtpCapabilities(
        client: Socket,
        payload: { roomId: string },
    ) {
        try {
            const { roomId } = payload;
            const rtpCapabilities = await this.voiceService.getRouterRtpCapabilities(roomId);

            client.emit('router_rtp_capabilities', {
                roomId,
                rtpCapabilities,
            });

            this.logger.log(`📡 RTP Capabilities enviadas para ${client.id}`);
        } catch (error) {
            this.logger.error(`Erro ao obter RTP capabilities: ${error.message}`);
            client.emit('voice_error', { message: error.message });
        }
    }

    /**
     * Criar WebRtcTransport
     */
    @SubscribeMessage('create_webrtc_transport')
    async handleCreateWebRtcTransport(
        client: Socket,
        payload: { roomId: string; direction: 'send' | 'recv' },
    ) {
        try {
            const { roomId, direction } = payload;

            const transportData = await this.voiceService.createWebRtcTransport(
                roomId,
                client.id,
                direction,
            );

            client.emit('webrtc_transport_created', {
                roomId,
                direction,
                id: transportData.id,
                iceParameters: transportData.iceParameters,
                iceCandidates: transportData.iceCandidates,
                dtlsParameters: transportData.dtlsParameters,
            });

            this.logger.log(`🚀 WebRtcTransport criado para ${client.id}`);
        } catch (error) {
            this.logger.error(`Erro ao criar WebRtcTransport: ${error.message}`);
            client.emit('voice_error', { message: error.message });
        }
    }

    /**
     * Conectar WebRtcTransport
     */
    @SubscribeMessage('connect_webrtc_transport')
    async handleConnectWebRtcTransport(
        client: Socket,
        payload: { roomId: string; transportId: string; dtlsParameters: any },
    ) {
        try {
            const { roomId, transportId, dtlsParameters } = payload;

            await this.voiceService.connectWebRtcTransport(
                roomId,
                client.id,
                transportId,
                dtlsParameters,
            );

            client.emit('webrtc_transport_connected', { transportId });

            this.logger.log(`🔗 WebRtcTransport conectado: ${transportId}`);
        } catch (error) {
            this.logger.error(`Erro ao conectar WebRtcTransport: ${error.message}`);
            client.emit('voice_error', { message: error.message });
        }
    }

    /**
     * Produzir áudio
     */
    @SubscribeMessage('produce')
    async handleProduce(
        client: Socket,
        payload: {
            roomId: string;
            transportId: string;
            kind: 'audio' | 'video';
            rtpParameters: any;
        },
    ) {
        try {
            const { roomId, transportId, kind, rtpParameters } = payload;

            const result = await this.voiceService.produce(
                roomId,
                client.id,
                transportId,
                kind,
                rtpParameters,
            );

            client.emit('produced', {
                id: result.id,
            });

            // Notificar TODOS na sala (inclusive o produtor) sobre o novo producer
            const users = this.voiceService.getVoiceUsers(roomId);
            this.server.to(`voice_${roomId}`).emit('voice_users_updated', {
                roomId,
                users,
            });

            this.server.to(`voice_${roomId}`).emit('new_producer', {
                userId: client.id,
                producerId: result.id,
                roomId,
            });

            this.logger.log(`🎤 Producer criado: ${result.id} para usuário ${client.id}`);
        } catch (error) {
            this.logger.error(`Erro ao produzir: ${error.message}`);
            client.emit('voice_error', { message: error.message });
        }
    }

    /**
     * Consumir áudio
     */
    @SubscribeMessage('consume')
    async handleConsume(
        client: Socket,
        payload: {
            roomId: string;
            producerId: string;
            rtpCapabilities: any;
        },
    ) {
        try {
            const { roomId, producerId, rtpCapabilities } = payload;

            const result = await this.voiceService.consume(
                roomId,
                client.id,
                producerId,
                rtpCapabilities,
            );

            client.emit('consumed', {
                id: result.id,
                producerId: result.producerId,
                kind: result.kind,
                rtpParameters: result.rtpParameters,
            });

            this.logger.log(`🔊 Consumer criado: ${result.id} para usuário ${client.id}`);
        } catch (error) {
            this.logger.error(`Erro ao consumir: ${error.message}`);
            client.emit('voice_error', { message: error.message });
        }
    }

    /**
     * Retomar consumer
     */
    @SubscribeMessage('resume_consumer')
    async handleResumeConsumer(
        client: Socket,
        payload: { roomId: string; consumerId: string },
    ) {
        try {
            const { roomId, consumerId } = payload;

            await this.voiceService.resumeConsumer(roomId, client.id, consumerId);

            client.emit('consumer_resumed', { consumerId });

            this.logger.log(`▶️ Consumer retomado: ${consumerId}`);
        } catch (error) {
            this.logger.error(`Erro ao retomar consumer: ${error.message}`);
            client.emit('voice_error', { message: error.message });
        }
    }

    /**
     * Obter producers disponíveis
     */
    @SubscribeMessage('get_producers')
    async handleGetProducers(client: Socket, payload: { roomId: string }) {
        try {
            const { roomId } = payload;

            const producers = this.voiceService.getProducersForUser(roomId, client.id);

            client.emit('producers_list', {
                roomId,
                producers,
            });

            this.logger.log(`📋 Lista de producers enviada para ${client.id}`);
        } catch (error) {
            this.logger.error(`Erro ao obter producers: ${error.message}`);
            client.emit('voice_error', { message: error.message });
        }
    }
}
