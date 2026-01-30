import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import { Consumer } from 'node_modules/mediasoup/node/lib/ConsumerTypes';
import { Producer } from 'node_modules/mediasoup/node/lib/ProducerTypes';
import { Router } from 'node_modules/mediasoup/node/lib/RouterTypes';
import { WebRtcTransport } from 'node_modules/mediasoup/node/lib/WebRtcTransportTypes';
import { Worker } from 'node_modules/mediasoup/node/lib/WorkerTypes';

interface VoiceUser {
    userId: string;
    userName: string;
    producerTransport?: WebRtcTransport;
    consumerTransport?: WebRtcTransport;
    producer?: Producer;
    consumers: Map<string, Consumer>;
    isMuted: boolean;
}

interface VoiceRoom {
    roomId: string;
    router: Router;
    users: Map<string, VoiceUser>;
}

@Injectable()
export class VoiceService implements OnModuleInit {
    private readonly logger = new Logger(VoiceService.name);
    private worker: Worker;
    private voiceRooms = new Map<string, VoiceRoom>();

    async onModuleInit() {
        await this.createWorker();
    }

    /**
     * Fase 1: Criar Worker do mediasoup
     */
    private async createWorker() {
        this.logger.log('🎙️ Iniciando mediasoup Worker...');

        this.worker = await mediasoup.createWorker({
            logLevel: 'warn',
            logTags: [
                'info',
                'ice',
                'dtls',
                'rtp',
                'srtp',
                'rtcp',
            ],
            rtcMinPort: 10000,
            rtcMaxPort: 10100,
        });

        this.worker.on('died', () => {
            this.logger.error('❌ mediasoup Worker morreu, saindo em 2s...');
            setTimeout(() => process.exit(1), 2000);
        });

        this.logger.log('✅ mediasoup Worker criado com sucesso');
    }

    /**
     * Fase 2: Criar ou reutilizar Router para uma sala
     */
    async getOrCreateRouter(roomId: string): Promise<Router> {
        let voiceRoom = this.voiceRooms.get(roomId);

        if (!voiceRoom) {
            this.logger.log(`📡 Criando Router para sala: ${roomId}`);

            const router = await this.worker.createRouter({
                mediaCodecs: [
                    {
                        kind: 'audio',
                        mimeType: 'audio/opus',
                        clockRate: 48000,
                        channels: 2,
                    },
                ],
            });

            voiceRoom = {
                roomId,
                router,
                users: new Map(),
            };

            this.voiceRooms.set(roomId, voiceRoom);
            this.logger.log(`✅ Router criado para sala: ${roomId}`);
        }

        return voiceRoom.router;
    }

    /**
     * Obter RTP Capabilities do Router
     */
    async getRouterRtpCapabilities(roomId: string) {
        const router = await this.getOrCreateRouter(roomId);
        return router.rtpCapabilities;
    }

    /**
     * Fase 2: Criar WebRtcTransport
     */
    async createWebRtcTransport(roomId: string, userId: string, direction: 'send' | 'recv') {
        const router = await this.getOrCreateRouter(roomId);
        const voiceRoom = this.voiceRooms.get(roomId);

        if (!voiceRoom) {
            throw new Error('Voice room not found');
        }

        const transport = await router.createWebRtcTransport({
            listenIps: [
                {
                    ip: '0.0.0.0',
                    announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
                },
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
        });

        this.logger.log(`🚀 WebRtcTransport criado para usuário ${userId} na sala ${roomId}`);

        const transportData = {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
            transport,
        };

        this.setUserTransport(roomId, userId, transport, direction);

        return transportData;
    }

    /**
     * Conectar WebRtcTransport
     */
    async connectWebRtcTransport(
        roomId: string,
        userId: string,
        transportId: string,
        dtlsParameters: any,
    ) {
        const voiceRoom = this.voiceRooms.get(roomId);
        if (!voiceRoom) {
            throw new Error('Voice room not found');
        }

        const user = voiceRoom.users.get(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const transport =
            user.producerTransport?.id === transportId
                ? user.producerTransport
                : user.consumerTransport?.id === transportId
                    ? user.consumerTransport
                    : null;

        if (transport) {
            await transport.connect({ dtlsParameters });
            this.logger.log(`🔗 Transport conectado: ${transportId}`);
            return;
        }

        throw new Error('Transport not found');
    }

    /**
     * Fase 2: Produzir áudio
     */
    async produce(
        roomId: string,
        userId: string,
        transportId: string,
        kind: 'audio' | 'video',
        rtpParameters: any,
    ) {
        const voiceRoom = this.voiceRooms.get(roomId);
        if (!voiceRoom) {
            throw new Error('Voice room not found');
        }

        const user = voiceRoom.users.get(userId);
        if (!user || !user.producerTransport) {
            throw new Error('User or transport not found');
        }

        const producer = await user.producerTransport.produce({
            kind,
            rtpParameters,
        });

        user.producer = producer;

        this.logger.log(`🎤 Producer criado para usuário ${userId} na sala ${roomId}`);

        return {
            id: producer.id,
        };
    }

    /**
     * Fase 2: Consumir áudio de outro usuário
     */
    async consume(
        roomId: string,
        userId: string,
        producerId: string,
        rtpCapabilities: any,
    ) {
        const voiceRoom = this.voiceRooms.get(roomId);
        if (!voiceRoom) {
            throw new Error('Voice room not found');
        }

        const router = voiceRoom.router;

        if (!router.canConsume({ producerId, rtpCapabilities })) {
            throw new Error('Cannot consume');
        }

        const user = voiceRoom.users.get(userId);
        if (!user || !user.consumerTransport) {
            throw new Error('User or transport not found');
        }

        const consumer = await user.consumerTransport.consume({
            producerId,
            rtpCapabilities,
            paused: true, // Iniciar pausado
        });

        user.consumers.set(consumer.id, consumer);

        this.logger.log(`🔊 Consumer criado para usuário ${userId} consumir producer ${producerId}`);

        return {
            id: consumer.id,
            producerId: consumer.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
        };
    }

    /**
     * Retomar consumer
     */
    async resumeConsumer(roomId: string, userId: string, consumerId: string) {
        const voiceRoom = this.voiceRooms.get(roomId);
        if (!voiceRoom) {
            throw new Error('Voice room not found');
        }

        const user = voiceRoom.users.get(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const consumer = user.consumers.get(consumerId);
        if (!consumer) {
            throw new Error('Consumer not found');
        }

        await consumer.resume();
        this.logger.log(`▶️ Consumer retomado: ${consumerId}`);
    }

    /**
     * Adicionar usuário ao canal de voz
     */
    async joinVoiceChannel(roomId: string, userId: string, userName: string) {
        const router = await this.getOrCreateRouter(roomId);
        const voiceRoom = this.voiceRooms.get(roomId);

        if (!voiceRoom) {
            throw new Error('Voice room not found');
        }

        if (!voiceRoom.users.has(userId)) {
            voiceRoom.users.set(userId, {
                userId,
                userName,
                producerTransport: undefined,
                consumerTransport: undefined,
                consumers: new Map(),
                isMuted: false,
            });

            this.logger.log(`👤 Usuário ${userName} (${userId}) entrou no canal de voz: ${roomId}`);
        }

        return {
            users: Array.from(voiceRoom.users.values()).map(u => ({
                userId: u.userId,
                userName: u.userName,
                isMuted: u.isMuted,
                hasProducer: !!u.producer,
            })),
        };
    }

    /**
     * Remover usuário do canal de voz
     */
    async leaveVoiceChannel(roomId: string, userId: string) {
        const voiceRoom = this.voiceRooms.get(roomId);
        if (!voiceRoom) {
            return;
        }

        const user = voiceRoom.users.get(userId);
        if (user) {
            // Fechar producer
            if (user.producer) {
                user.producer.close();
            }

            // Fechar consumers
            for (const consumer of user.consumers.values()) {
                consumer.close();
            }

            // Fechar transport
            if (user.producerTransport) {
                user.producerTransport.close();
            }

            if (user.consumerTransport) {
                user.consumerTransport.close();
            }

            voiceRoom.users.delete(userId);
            this.logger.log(`👋 Usuário ${userId} saiu do canal de voz: ${roomId}`);
        }

        // Se a sala ficou vazia, fechar o router
        if (voiceRoom.users.size === 0) {
            voiceRoom.router.close();
            this.voiceRooms.delete(roomId);
            this.logger.log(`🗑️ Sala de voz ${roomId} removida (vazia)`);
        }
    }

    /**
     * Toggle mute/unmute
     */
    async toggleMute(roomId: string, userId: string, isMuted: boolean) {
        const voiceRoom = this.voiceRooms.get(roomId);
        if (!voiceRoom) {
            throw new Error('Voice room not found');
        }

        const user = voiceRoom.users.get(userId);
        if (!user) {
            throw new Error('User not found in voice room');
        }

        user.isMuted = isMuted;

        if (user.producer) {
            if (isMuted) {
                await user.producer.pause();
            } else {
                await user.producer.resume();
            }
        }

        this.logger.log(`🔇 Usuário ${userId} ${isMuted ? 'mutado' : 'desmutado'} na sala ${roomId}`);

        return { isMuted };
    }

    /**
     * Obter todos os producers de uma sala (exceto o do próprio usuário)
     */
    getProducersForUser(roomId: string, userId: string) {
        const voiceRoom = this.voiceRooms.get(roomId);
        if (!voiceRoom) {
            return [];
        }

        const producers: { userId: string; userName: string; producerId: string }[] = [];
        for (const [uid, user] of voiceRoom.users.entries()) {
            if (uid !== userId && user.producer) {
                producers.push({
                    userId: uid,
                    userName: user.userName,
                    producerId: user.producer.id,
                });
            }
        }

        return producers;
    }

    /**
     * Atualizar transport de um usuário
     */
    setUserTransport(
        roomId: string,
        userId: string,
        transport: WebRtcTransport,
        direction: 'send' | 'recv',
    ) {
        const voiceRoom = this.voiceRooms.get(roomId);
        if (!voiceRoom) {
            throw new Error('Voice room not found');
        }

        const user = voiceRoom.users.get(userId);
        if (!user) {
            throw new Error('User not found');
        }

        if (direction === 'send') {
            user.producerTransport = transport;
        } else {
            user.consumerTransport = transport;
        }
    }

    /**
     * Obter usuários no canal de voz
     */
    getVoiceUsers(roomId: string) {
        const voiceRoom = this.voiceRooms.get(roomId);
        if (!voiceRoom) {
            return [];
        }

        return Array.from(voiceRoom.users.values()).map(u => ({
            userId: u.userId,
            userName: u.userName,
            isMuted: u.isMuted,
            hasProducer: !!u.producer,
        }));
    }
}
