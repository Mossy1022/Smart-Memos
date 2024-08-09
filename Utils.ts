import { App, TFile, TFolder, normalizePath } from 'obsidian';

// Updated saveFile utility
export async function saveFile(app: App, audioBlob: Blob, fileName: string, path: string): Promise<TFile> {
    try {
        const normalizedPath = normalizePath(path);
        const filePath = `${normalizedPath}/${fileName}`;

        await ensureDirectoryExists(app, normalizedPath);

        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioData = new Uint8Array(arrayBuffer);

        // Check and add WAV header if missing
        let fileData;
        if (audioData.slice(0, 4).toString() !== 'RIFF') {
            const header = this.createWavHeader(audioData.length);
            fileData = new Uint8Array(header.length + audioData.length);
            fileData.set(header, 0);
            fileData.set(audioData, header.length);
        } else {
            fileData = audioData;
        }

        const file = await app.vault.createBinary(filePath, fileData);
        if (!file) {
            throw new Error('File creation failed and returned null');
        }
        return file;
    } catch (error) {
        console.error('Error saving audio file:', error);
        throw error;
    }
}

async function ensureDirectoryExists(app: App, folderPath: string) {
    const parts = folderPath.split('/');
    let currentPath = '';

    for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        try {
            const folder = app.vault.getAbstractFileByPath(currentPath);
            if (!folder) {
                await app.vault.createFolder(currentPath);
            } else if (folder instanceof TFolder) {
                console.log(`Folder already exists: ${currentPath}`);
            } else {
                throw new Error(`${currentPath} is not a folder`);
            }
        } catch (error) {
            if (error.message.includes('Folder already exists')) {
                // Folder already exists, continue to the next part
                console.log(`Handled existing folder: ${currentPath}`);
            } else {
                console.error(`Error ensuring directory exists: ${error.message}`);
                throw error;
            }
        }
    }

    // Helper function to create a WAV header
function createWavHeader(length, sampleRate = 44100, numChannels = 1, bitsPerSample = 16) {
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = length * numChannels * bitsPerSample / 8;
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    view.setUint32(0, 1380533830, false); // 'RIFF'
    view.setUint32(4, 36 + dataSize, true);
    view.setUint32(8, 1463899717, false); // 'WAVE'

    // fmt sub-chunk
    view.setUint32(12, 1718449184, false); // 'fmt '
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data sub-chunk
    view.setUint32(36, 1684108385, false); // 'data'
    view.setUint32(40, dataSize, true);

    return new Uint8Array(buffer);
}

}