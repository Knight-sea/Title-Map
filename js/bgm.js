let widget = null;
let iframe = null;

export function initBGM() {
  document.getElementById('bgm-play').addEventListener('click', () => play());
  document.getElementById('bgm-stop').addEventListener('click', () => stop());
  document.getElementById('bgm-volume').addEventListener('input', (e) => {
    if (widget) widget.setVolume(parseInt(e.target.value));
  });
}

export function loadSoundCloud(url) {
  if (!url) return;
  // Remove existing
  if (iframe) iframe.remove();

  iframe = document.createElement('iframe');
  iframe.id = 'sc-widget';
  iframe.width = '0';
  iframe.height = '0';
  iframe.style.display = 'none';
  iframe.allow = 'autoplay';
  iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false`;
  document.body.appendChild(iframe);

  // Load SC widget API
  if (!window.SC) {
    const script = document.createElement('script');
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.onload = () => initWidget();
    document.body.appendChild(script);
  } else {
    initWidget();
  }
}

function initWidget() {
  if (!iframe || !window.SC) return;
  widget = SC.Widget(iframe);
  widget.bind(SC.Widget.Events.FINISH, () => {
    // Loop
    widget.seekTo(0);
    widget.play();
  });
}

function play() {
  if (widget) widget.play();
}

function stop() {
  if (widget) widget.pause();
}
