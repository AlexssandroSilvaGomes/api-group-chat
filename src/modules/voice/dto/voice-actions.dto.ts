export class JoinVoiceChannelDto {
    roomId: string;
}

export class LeaveVoiceChannelDto {
    roomId: string;
}

export class ToggleMuteDto {
    roomId: string;
    isMuted: boolean;
}

export class GetRouterRtpCapabilitiesDto {
    roomId: string;
}

export class CreateWebRtcTransportDto {
    roomId: string;
}

export class ConnectWebRtcTransportDto {
    roomId: string;
    transportId: string;
    dtlsParameters: any;
}

export class ProduceDto {
    roomId: string;
    transportId: string;
    kind: 'audio' | 'video';
    rtpParameters: any;
}

export class ConsumeDto {
    roomId: string;
    producerId: string;
    rtpCapabilities: any;
}

export class ResumeConsumerDto {
    roomId: string;
    consumerId: string;
}
