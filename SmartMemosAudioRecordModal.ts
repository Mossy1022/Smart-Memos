import { Modal, setIcon } from 'obsidian';

export class SmartMemosAudioRecordModal extends Modal {
    private mediaRecorder: MediaRecorder | null = null;
    private chunks: BlobPart[] = [];
    private resolve: (value: Blob | PromiseLike<Blob>) => void;
    private reject: (reason?: any) => void;
    private handleAudioRecording: (audioFile: Blob | null, transcribe: boolean, template: string | null) => void;
    private isRecording: boolean = false;
    private timer: HTMLElement;
    private intervalId: number | null = null;
    private startTime: number = 0;
    private elapsedTime: number = 0; // To keep track of the elapsed time
    private redDot: HTMLElement;
    private isResetting: boolean = false; // Flag to track reset state

    constructor(app: any, handleAudioRecording: (audioFile: Blob | null, transcribe: boolean, template: string | null) => void) {
        super(app);
        this.handleAudioRecording = handleAudioRecording;
    }

    onOpen() {
        const { contentEl, modalEl } = this;

        if (!contentEl || !modalEl) {
            console.error('contentEl or modalEl is null');
            return;
        }

        // Apply initial recording state
        modalEl.addClass('smart-memo-recording');

        // Header and timer container
        const headerTimerContainer = contentEl.createDiv({ cls: 'smart-memo-header-timer-container' });
        const header = headerTimerContainer.createEl('h2', { text: 'Recording...', cls: 'smart-memo-recording-header' });
        this.timer = headerTimerContainer.createEl('div', { cls: 'smart-memo-timer', text: '00:00' });

        // Add specific class to modal-content
        contentEl.addClass('smart-memo-audio-record-modal-content');

        // Red dot animation container
        const redDotContainer = contentEl.createDiv({ cls: 'smart-memo-red-dot-container' });
        this.redDot = redDotContainer.createDiv({ cls: 'smart-memo-red-dot' });

        // Control buttons group
        const controlGroupWrapper = contentEl.createDiv({ cls: 'smart-memo-control-group-wrapper' });
        const controlGroup = controlGroupWrapper.createDiv({ cls: 'smart-memo-modal-button-group' });
        const playPauseButton = controlGroup.createEl('button', { cls: 'smart-memo-modal-button smart-memo-flex' });
        const stopButton = controlGroup.createEl('button', { cls: 'smart-memo-modal-button smart-memo-flex' });

        setIcon(playPauseButton, 'pause'); // Initially set to pause
        setIcon(stopButton, 'square'); // Stop icon

        stopButton.addEventListener('click', async () => {
            const audioFile = await this.stopRecording();
            this.handleAudioRecording(audioFile, false, null);
        });

        playPauseButton.addEventListener('click', () => {
            if (this.isRecording) {
                this.pauseRecording();
                setIcon(playPauseButton, 'circle');
                header.textContent = 'Paused';
                modalEl.addClass('smart-memo-paused');
                modalEl.removeClass('smart-memo-recording');
            } else {
                this.resumeOrStartRecording();
                setIcon(playPauseButton, 'pause');
                header.textContent = 'Recording...';
                modalEl.removeClass('smart-memo-paused');
                modalEl.addClass('smart-memo-recording');
            }
            this.isRecording = !this.isRecording;
        });

        // if window.smart_env.smart_transcribe then list templates in dropdown
        let template: string | null = null;
        if (window.smart_env?.smart_templates) {
            const transcribeDropdown = controlGroupWrapper.createEl('select', { cls: 'smart-memo-modal-button smart-memo-full-width-button smart-memo-transcribe-dropdown' });
            const transcribeTemplates = window.smart_env.smart_templates.templates;
            // add empty option
            transcribeDropdown.createEl('option', { text: 'Select Smart Template' });
            for (const template of transcribeTemplates) {
                const option = transcribeDropdown.createEl('option', { text: template });
            }
            transcribeDropdown.addEventListener('change', (event: Event) => {
                template = (event.target as HTMLSelectElement).value;
                if (template === 'Select Smart Template') {
                    template = null;
                }
            });
        }

        const transcribeButton = controlGroupWrapper.createEl('button', { cls: 'smart-memo-modal-button smart-memo-full-width-button smart-memo-transcribe-button' });

        transcribeButton.addEventListener('click', async () => {
            const audioFile = await this.stopRecording();
            this.handleAudioRecording(audioFile, true, template);
        });

        setIcon(transcribeButton, 'file-text'); // Initially set to bulb

        // Append text to the button
        const buttonText = document.createTextNode(' Smart Transcribe');
        transcribeButton.appendChild(buttonText);

        // Add margin-right to the SVG element
        const svgElement = transcribeButton.querySelector('svg');
        if (svgElement) {
            svgElement.style.marginRight = '10px';
        }

        const resetButton = contentEl.createEl('button', { cls: 'smart-memo-modal-button smart-memo-full-width-button smart-memo-reset-button', text: 'Restart' });
        resetButton.addEventListener('click', () => {
            this.hardReset();
            setIcon(playPauseButton, 'circle');
            header.textContent = 'Ready to Record';
            this.isRecording = false;
            modalEl.addClass('smart-memo-paused');
            modalEl.removeClass('smart-memo-recording');
            // Ensure red dot stops pulsing
            this.redDot.classList.remove('smart-memo-pulse-animation');
        });

        // Start recording immediately upon opening the modal
        this.startRecording();
        this.isRecording = true;
        this.redDot.classList.add('smart-memo-pulse-animation');

        // Blur any focused element
        const activeElement = document.activeElement as HTMLElement;
        if (activeElement) {
            activeElement.blur();
        }
    }

    startRecording() {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                this.mediaRecorder = new MediaRecorder(stream);
                this.setupMediaRecorder();
                this.mediaRecorder.start(1000);
                this.startTime = Date.now();
                this.startTimer();
                this.mediaRecorder.addEventListener('dataavailable', this.onDataAvailable.bind(this));
            })
            .catch(error => {
                console.error('Error accessing microphone:', error);
                this.reject(error);
            });
    }

    setupMediaRecorder() {
        if (this.mediaRecorder) {
            this.mediaRecorder.addEventListener('stop', this.onStop.bind(this));
        }
    }

    onDataAvailable(event: BlobEvent) {
        if (this.isResetting) {
            return;
        }
        this.chunks.push(event.data);
    }

    onStop() {
        if (this.isResetting) {
            this.isResetting = false; // Reset the flag after reset
            return;
        }
        const blob = new Blob(this.chunks, { type: 'audio/wav' });
        if (this.resolve) {
            this.resolve(blob);
            this.close();
        } else {
            console.error('Resolve function is not defined');
        }
    }

    pauseRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.pause();
            this.stopTimer();
            this.elapsedTime += Date.now() - this.startTime; // Accumulate elapsed time

            // Ensure red dot stops pulsing
            this.redDot.classList.remove('smart-memo-pulse-animation');
        }
    }

    resumeOrStartRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
            this.mediaRecorder.resume();
        } else {
            this.startRecording();
        }
        this.startTime = Date.now(); // Reset start time to now
        this.startTimer();

        // Ensure red dot starts pulsing
        this.redDot.classList.add('smart-memo-pulse-animation');
    }

    hardReset() {
        if (this.mediaRecorder) {
            this.mediaRecorder.stop();
            this.mediaRecorder.onstop = null;
            this.mediaRecorder.ondataavailable = null;
            this.mediaRecorder = null;
        }
        this.isResetting = true; // Set the reset flag
        this.chunks = []; // Clear the chunks
        this.elapsedTime = 0; // Reset elapsed time
        this.stopTimer();
        this.timer.textContent = '00:00';
        // Ensure red dot stops pulsing
        this.redDot.classList.remove('smart-memo-pulse-animation'); // Ensure it's removed on reset
    }

    stopRecording() {
        return new Promise<Blob | null>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
            if (this.mediaRecorder) {
                this.mediaRecorder.addEventListener('stop', this.onStop.bind(this));
                this.mediaRecorder.stop();
                this.stopTimer();
            } else {
                resolve(null);
            }
        });
    }

    startTimer() {
        this.stopTimer(); // Clear any existing timer
        this.intervalId = window.setInterval(() => {
            const elapsedTimeInSeconds = Math.floor(this.elapsedTime / 1000) + Math.floor((Date.now() - this.startTime) / 1000);
            const minutes = Math.floor(elapsedTimeInSeconds / 60);
            const seconds = elapsedTimeInSeconds % 60;
            this.timer.textContent = `${this.padNumber(minutes)}:${this.padNumber(seconds)}`;
        }, 1000);
    }

    stopTimer() {
        if (this.intervalId !== null) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    padNumber(num: number): string {
        return num.toString().padStart(2, '0');
    }


    open() {
        super.open();
        return new Promise<Blob>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}
