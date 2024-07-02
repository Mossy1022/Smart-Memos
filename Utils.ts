import { App, TFile, TFolder } from 'obsidian';

export async function saveFile(app: App, audioBlob: Blob, fileName: string, path: string): Promise<TFile> {
    try {
        const filePath = `${path}/${fileName}`;

        await directoryExistsAtPath(app, path);

        const arrayBuffer = await audioBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const file = await app.vault.createBinary(filePath, uint8Array);
        if (!file) {
            throw new Error('File creation failed and returned null');
        }
        return file;
    } catch (error) {
        console.error('Error saving audio file:', error);
        throw error;
    }
}

async function directoryExistsAtPath(app: App, folderPath: string) {
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
            console.error(`Error ensuring directory exists: ${error.message}`);
            throw error;
        }
    }
}