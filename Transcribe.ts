import {  Notice } from 'obsidian';


// Add a new method to transcribe the audio file and generate text
export async function generateTranscript(audioBuffer: ArrayBuffer, filetype: string, requestAdapter : any, audioConfig : any) {
    if (this.settings.apiKey.length <= 1) throw new Error('OpenAI API Key is not provided.');

    // Reference: www.stackoverflow.com/questions/74276173/how-to-send-multipart-form-data-payload-with-typescript-obsidian-library
    const N = 16 // The length of our random boundry string
    const randomBoundryString = 'WebKitFormBoundary' + Array(N + 1).join((Math.random().toString(36) + '00000000000000000').slice(2, 18)).slice(0, N)
    const pre_string = `------${randomBoundryString}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: "application/octet-stream"\r\n\r\n`;
    const post_string = `\r\n------${randomBoundryString}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n------${randomBoundryString}--\r\n`
    const pre_string_encoded = new TextEncoder().encode(pre_string);
    const post_string_encoded = new TextEncoder().encode(post_string);


    // Create an array to store the results
    let results = [];

    // Process each chunk
    for (let i = 0; i < audioConfig.numChunks; i++) {

        // new Notice(`Transcribing chunk #${i + 1}...`);

        // Get the start and end indices for this chunk
        const start = i * audioConfig.chunkSize;
        const end = Math.min(start + audioConfig.chunkSize, audioBuffer.byteLength);

        // Extract the chunk from the audio buffer
        const chunk = audioBuffer.slice(start, end);

        // Concatenate the chunk with the pre and post strings
        const concatenated = await new Blob([pre_string_encoded, chunk, post_string_encoded]).arrayBuffer()

        const options: RequestUrlParam = {
            url: 'https://api.openai.com/v1/audio/transcriptions',
            method: 'POST',
            contentType: `multipart/form-data; boundary=----${randomBoundryString}`,
            headers: {
                'Authorization': 'Bearer ' + this.settings.apiKey
            },
            body: concatenated
        };

        const response = await requestUrl(options).catch((error) => {
            if (error.message.includes('401')) throw new Error('OpenAI API Key is not valid.');
            else throw error;
        });
        
        if ('text' in response.json) {
            // Add the result to the results array
            // @ts-ignore
            results.push(response.json.text);
        }
        else throw new Error('Error. ' + JSON.stringify(response.json));

        // Wait for 1 second before processing the next chunk
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    // Return all the results
    return results.join(' ');
}


