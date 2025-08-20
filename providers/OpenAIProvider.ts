import { Notice } from 'obsidian';
import { AIProvider, AIProviderSettings, GenerationOptions } from './AIProvider';
const { SmartChatModel } = require('smart-chat-model');

export class OpenAIProvider extends AIProvider {
    private audioContext: AudioContext;
    
    constructor(settings: AIProviderSettings, audioContext: AudioContext) {
        super(settings);
        this.audioContext = audioContext;
    }
    
    getName(): string {
        return 'OpenAI';
    }
    
    async transcribe(audioBuffer: ArrayBuffer, audioContext: AudioContext): Promise<string> {
        if (!this.settings.apiKey || this.settings.apiKey.length <= 1) {
            throw new Error('OpenAI API Key is not provided.');
        }
        
        try {
            const decodedAudioData = await audioContext.decodeAudioData(audioBuffer);
            
            const targetSampleRate = 16000;
            const downsampledAudioBuffer = await this.downsampleAudioBuffer(decodedAudioData, targetSampleRate);
            
            const chunkDuration = 600; // 10 minutes
            const audioChunks = this.splitAudioBuffer(downsampledAudioBuffer, chunkDuration);
            
            const results: string[] = [];
            
            for (let i = 0; i < audioChunks.length; i++) {
                new Notice(`Transcribing chunk #${i + 1} of ${audioChunks.length}...`);
                
                const wavArrayBuffer = this.encodeAudioBufferToWav(audioChunks[i]);
                
                const sizeInMB = wavArrayBuffer.byteLength / (1024 * 1024);
                if (sizeInMB > 24) {
                    throw new Error('Chunk size exceeds 25 MB limit.');
                }
                
                const formData = new FormData();
                const blob = new Blob([wavArrayBuffer], { type: 'audio/wav' });
                formData.append('file', blob, 'audio.wav');
                formData.append('model', 'whisper-1');
                
                const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + this.settings.apiKey
                    },
                    body: formData
                });
                
                const result = await response.json();
                if (response.ok && result.text) {
                    results.push(result.text);
                } else {
                    throw new Error(`Error: ${result.error?.message || 'Unknown error'}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            return results.join(' ');
            
        } catch (error: any) {
            console.error('Transcription failed:', error);
            if (error.message.includes('401')) {
                throw new Error('OpenAI API Key is not valid.');
            } else if (error.message.includes('400')) {
                throw new Error('Bad Request. Please check the format of the request.');
            } else {
                throw error;
            }
        }
    }
    
    async generateText(options: GenerationOptions): Promise<string> {
        if (!this.settings.apiKey || this.settings.apiKey.length <= 1) {
            throw new Error('OpenAI API Key is not provided.');
        }
        
        const mock_env = {
            chunk_handler: options.onChunk || (() => {}),
            done_handler: options.onComplete || (() => {})
        };
        
        const smart_chat_model = new SmartChatModel(
            mock_env,
            "openai",
            {
                api_key: this.settings.apiKey,
                model: this.settings.model,
            }
        );
        
        const resp = await smart_chat_model.complete({ messages: options.messages });
        return resp;
    }
    
    async getAvailableModels(): Promise<string[]> {
        return [
            'gpt-5',
            'gpt-5-mini',
            'gpt-5-nano',
            'gpt-4.5',
            'gpt-4.1',
            'gpt-4.1-mini',
            'gpt-4o',
            'gpt-4o-mini',
            'gpt-4-turbo',
            'gpt-4',
            'gpt-3.5-turbo',
            'o1-preview',
            'o1-mini'
        ];
    }
    
    async validateSettings(): Promise<boolean> {
        if (!this.settings.apiKey || this.settings.apiKey.length <= 1) {
            return false;
        }
        
        try {
            const response = await fetch('https://api.openai.com/v1/models', {
                headers: {
                    'Authorization': 'Bearer ' + this.settings.apiKey
                }
            });
            return response.ok;
        } catch {
            return false;
        }
    }
    
    private async downsampleAudioBuffer(audioBuffer: AudioBuffer, targetSampleRate: number): Promise<AudioBuffer> {
        const numberOfChannels = audioBuffer.numberOfChannels;
        const duration = audioBuffer.duration;
        
        const offlineContext = new OfflineAudioContext(numberOfChannels, targetSampleRate * duration, targetSampleRate);
        
        const bufferSource = offlineContext.createBufferSource();
        bufferSource.buffer = audioBuffer;
        bufferSource.connect(offlineContext.destination);
        bufferSource.start(0);
        
        return await offlineContext.startRendering();
    }
    
    private splitAudioBuffer(audioBuffer: AudioBuffer, chunkDuration: number): AudioBuffer[] {
        const numberOfChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const totalSamples = audioBuffer.length;
        
        const chunks: AudioBuffer[] = [];
        let offset = 0;
        const samplesPerChunk = Math.floor(chunkDuration * sampleRate);
        
        while (offset < totalSamples) {
            const chunkSamples = Math.min(samplesPerChunk, totalSamples - offset);
            const chunkBuffer = new AudioBuffer({
                numberOfChannels: numberOfChannels,
                length: chunkSamples,
                sampleRate: sampleRate
            });
            
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const channelData = audioBuffer.getChannelData(channel);
                const chunkChannelData = chunkBuffer.getChannelData(channel);
                for (let i = 0; i < chunkSamples; i++) {
                    chunkChannelData[i] = channelData[offset + i];
                }
            }
            
            chunks.push(chunkBuffer);
            offset += chunkSamples;
        }
        
        return chunks;
    }
    
    private encodeAudioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;
        
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        
        const numSamples = audioBuffer.length * numChannels;
        const buffer = new ArrayBuffer(44 + numSamples * bytesPerSample);
        const view = new DataView(buffer);
        
        const writeString = (offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + numSamples * bytesPerSample, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, numSamples * bytesPerSample, true);
        
        let offset = 44;
        for (let i = 0; i < audioBuffer.length; i++) {
            for (let channel = 0; channel < numChannels; channel++) {
                let sample = audioBuffer.getChannelData(channel)[i];
                sample = Math.max(-1, Math.min(1, sample));
                sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(offset, sample, true);
                offset += 2;
            }
        }
        
        return buffer;
    }
}