import { Editor } from 'obsidian';

export interface TranscriptionResult {
    text: string;
    error?: string;
}

export interface GenerationOptions {
    messages: Array<{role: string; content: string}>;
    onChunk?: (chunk: string) => void;
    onComplete?: (fullText: string) => void;
}

export interface AIProviderSettings {
    apiKey?: string;
    model: string;
    endpoint?: string;
    [key: string]: any;
}

export abstract class AIProvider {
    protected settings: AIProviderSettings;
    
    constructor(settings: AIProviderSettings) {
        this.settings = settings;
    }
    
    abstract transcribe(audioBuffer: ArrayBuffer, audioContext: AudioContext): Promise<string>;
    
    abstract generateText(options: GenerationOptions): Promise<string>;
    
    abstract getAvailableModels(): Promise<string[]>;
    
    abstract validateSettings(): Promise<boolean>;
    
    abstract getName(): string;
}