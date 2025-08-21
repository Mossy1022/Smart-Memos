import { AIProvider, AIProviderSettings } from './AIProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GeminiProvider } from './GeminiProvider';

export type ProviderType = 'openai' | 'gemini';

export interface ProviderConfig {
    type: ProviderType;
    settings: AIProviderSettings;
    audioContext: AudioContext;
}

export class ProviderFactory {
    static createProvider(config: ProviderConfig): AIProvider {
        switch (config.type) {
            case 'openai':
                return new OpenAIProvider(config.settings, config.audioContext);
            
            case 'gemini':
                return new GeminiProvider(config.settings, config.audioContext);
            
            default:
                throw new Error(`Unknown provider type: ${config.type}`);
        }
    }
    
    static getProviderSettings(type: ProviderType, allSettings: any): AIProviderSettings {
        switch (type) {
            case 'openai':
                return {
                    apiKey: allSettings.apiKey,
                    model: allSettings.model
                };
            
            case 'gemini':
                return {
                    apiKey: allSettings.geminiApiKey,
                    model: allSettings.geminiModel || 'gemini-2.0-flash-exp'
                };
            
            default:
                throw new Error(`Unknown provider type: ${type}`);
        }
    }
}