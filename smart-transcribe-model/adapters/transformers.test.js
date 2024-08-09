import test from 'ava';
import wavefile from 'wavefile';
import { TransformersAdapter } from './transformers.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { SmartTranscribeModel } from '../smart_transcribe_model.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


test('SmartTranscribeModel transcribes audio correctly', async (t) => {
  // Create an instance of SmartTranscribeModel
// Increase timeout to 5 minutes (300,000 ms)
t.timeout(300000);
  let config = {
    model_key: 'Xenova/whisper-large-v3',
    adapter: 'transformers'
}
  const smartTranscribeModel = new SmartTranscribeModel({}, config);

  // Load a sample audio file
  const audioPath = path.join(__dirname, 'test2.wav');
  const audioBuffer = await fs.readFile(audioPath);

   // Check if audio buffer is a valid WAV format
   if (!audioBuffer || audioBuffer.length < 44) {
    throw new Error('Invalid audio buffer');
  }

  // Log the first few bytes of the buffer
  console.log('Audio buffer header:', audioBuffer.slice(0, 4).toString('ascii'));

  // Ensure the buffer starts with the "RIFF" identifier
  if (audioBuffer.subarray(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error('Invalid WAV file: Missing "RIFF" header');
  }

  let wav = new wavefile.WaveFile(audioBuffer);
  console.log('WaveFile created with bit depth:', wav.fmt.bitsPerSample);
  console.log('WaveFile sample rate:', wav.fmt.sampleRate);

  wav.toBitDepth('32f'); // Pipeline expects input as a Float32Array
  wav.toSampleRate(16000); // Whisper expects audio with a sampling rate of 16000
  let audioData = wav.getSamples();

  if (Array.isArray(audioData)) {
    if (audioData.length > 1) {
      const SCALING_FACTOR = Math.sqrt(2);
      // Merge channels (into first channel to save memory)
      for (let i = 0; i < audioData[0].length; ++i) {
        audioData[0][i] = SCALING_FACTOR * (audioData[0][i] + audioData[1][i]) / 2;
      }
    }
    // Select first channel
    audioData = audioData[0];
  }


  // Transcribe the audio
  const result = await smartTranscribeModel.transcribe(audioData);

  console.log('result: ', result);
  // Assert that the result is a non-empty string
  t.true(typeof result.text === 'string');
  t.true(result.text.length > 0);

  // You might want to add more specific assertions based on the expected content of your sample audio
  t.regex(result.text, /\w+/); // Ensure the result contains at least one word

  // Clean up
  await model.unload();
});