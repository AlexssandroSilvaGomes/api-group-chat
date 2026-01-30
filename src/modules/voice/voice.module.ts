import { Module } from '@nestjs/common';
import { VoiceGateway } from './voice.gateway';
import { VoiceService } from './voice.service';

@Module({
    providers: [VoiceGateway, VoiceService],
    exports: [VoiceService],
})
export class VoiceModule { }
