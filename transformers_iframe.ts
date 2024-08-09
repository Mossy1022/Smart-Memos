window.addEventListener('message', init);

async function init(event: MessageEvent) {
    if (event.data.type === 'init') {
        window.removeEventListener('message', init);
        const model_config = event.data.model_config;
        console.log(model_config);
        const { TransformersIframeConnector } = await import('./iframehandler');
        const model = await TransformersIframeConnector.create(model_config, window);
        window.model = model;
    }
}