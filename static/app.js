"use strict";

const elements = {
  aboutDialog: document.querySelector("#aboutDialog"),
  captureStep: document.querySelector("#captureStep"),
  chatConversationFeed: document.querySelector("#chatConversationFeed"),
  chatInput: document.querySelector("#chatInput"),
  chatSendButton: document.querySelector("#chatSendButton"),
  chatTab: document.querySelector("#chatTab"),
  chatTabPanel: document.querySelector("#chatTabPanel"),
  connectionChip: document.querySelector("#connectionChip"),
  connectionLabel: document.querySelector("#connectionLabel"),
  contextClearButton: document.querySelector("#contextClearButton"),
  contextDescription: document.querySelector("#contextDescription"),
  contextDock: document.querySelector("#contextDock"),
  contextFileInput: document.querySelector("#contextFileInput"),
  contextModeChip: document.querySelector("#contextModeChip"),
  contextTitle: document.querySelector("#contextTitle"),
  contextUploadButton: document.querySelector("#contextUploadButton"),
  contextUploadLabel: document.querySelector("#contextUploadLabel"),
  dialogCloseButton: document.querySelector("#dialogCloseButton"),
  dialogDoneButton: document.querySelector("#dialogDoneButton"),
  emotionSelect: document.querySelector("#emotionSelect"),
  languageSelect: document.querySelector("#languageSelect"),
  micButton: document.querySelector("#micButton"),
  modeBadge: document.querySelector("#modeBadge"),
  muteButton: document.querySelector("#muteButton"),
  muteButtonLabel: document.querySelector("#muteButtonLabel"),
  reasonStep: document.querySelector("#reasonStep"),
  recordButton: document.querySelector("#recordButton"),
  recordButtonLabel: document.querySelector("#recordButtonLabel"),
  resetChatButton: document.querySelector("#resetChatButton"),
  resetVoiceButton: document.querySelector("#resetVoiceButton"),
  responseAudio: document.querySelector("#responseAudio"),
  speakStep: document.querySelector("#speakStep"),
  spokenResponseStatus: document.querySelector("#spokenResponseStatus"),
  stopVoiceButton: document.querySelector("#stopVoiceButton"),
  themeInfoButton: document.querySelector("#themeInfoButton"),
  toast: document.querySelector("#toast"),
  transcriptWordCount: document.querySelector("#transcriptWordCount"),
  voiceSelect: document.querySelector("#voiceSelect"),
  voiceError: document.querySelector("#voiceError"),
  voiceErrorClose: document.querySelector("#voiceErrorClose"),
  voiceErrorMessage: document.querySelector("#voiceErrorMessage"),
  voiceStage: document.querySelector("#voiceStage"),
  voiceStatusDetail: document.querySelector("#voiceStatusDetail"),
  voiceStatusTitle: document.querySelector("#voiceStatusTitle"),
  voiceTab: document.querySelector("#voiceTab"),
  voiceTabPanel: document.querySelector("#voiceTabPanel"),
  voiceTranscript: document.querySelector("#voiceTranscript"),
};

function applyIcon(element, name = "") {
  if (!element) return;
  const iconName = name || element.textContent.trim() || element.dataset.icon;
  element.dataset.icon = iconName;
  element.textContent = "";
}

function hydrateIcons(root = document) {
  root.querySelectorAll(".material-symbols-rounded").forEach((icon) => applyIcon(icon));
}

hydrateIcons();

const state = {
  activeTab: "voice",
  agentAvailable: false,
  agentConnected: false,
  analyserFrame: null,
  chatApiReady: false,
  audioContext: null,
  chatBusy: false,
  chatConversation: [],
  contextActive: false,
  contextBusy: false,
  contextCharacters: 0,
  contextFilename: "",
  contextId: crypto.randomUUID(),
  contextTruncated: false,
  dataChannel: null,
  finalTranscript: "",
  keepAliveTimer: null,
  muted: false,
  outputSuppressed: false,
  peerConnection: null,
  recording: false,
  remoteStream: null,
  stream: null,
  toastTimer: null,
  transcript: "",
  voiceApiReady: false,
  voiceCatalog: null,
  voiceError: "",
};

const modeCopy = {
  ready: ["READY", "Tap to start talking", "The agent keeps context until you start a new session.", "Waiting for your question"],
  connecting: ["CONNECTING", "Starting the live agent", "Opening a secure microphone and WebRTC session...", "Connecting to Pipecat"],
  listening: ["LISTENING", "Listening now", "Speak naturally, then tap stop to finish your turn.", "NVIDIA ASR is listening"],
  muted: ["INPUT MUTED", "Microphone is muted", "Unmute whenever you are ready to continue.", "Voice input paused"],
  thinking: ["THINKING", "Considering your question", "Nemotron is preparing a concise response...", "Reasoning with Nemotron"],
  synthesizing: ["CREATING VOICE", "Preparing the spoken answer", "Magpie is streaming the answer into speech...", "Magpie is creating audio"],
  speaking: ["SPEAKING", "Playing the response", "Start talking to interrupt, or use Stop spoken response.", "Speaking now"],
};

function updateFlow(mode) {
  const steps = [elements.captureStep, elements.reasonStep, elements.speakStep];
  steps.forEach((step) => step.classList.remove("active", "complete"));
  if (["ready", "connecting", "listening", "muted"].includes(mode)) {
    elements.captureStep.classList.add("active");
  } else if (mode === "thinking") {
    elements.captureStep.classList.add("complete");
    elements.reasonStep.classList.add("active");
  } else if (["synthesizing", "speaking"].includes(mode)) {
    elements.captureStep.classList.add("complete");
    elements.reasonStep.classList.add("complete");
    elements.speakStep.classList.add("active");
  }
}

function setMode(mode, overrideTitle = "", overrideDetail = "", overrideSpoken = "") {
  const copy = modeCopy[mode] || modeCopy.ready;
  document.body.dataset.mode = mode;
  elements.modeBadge.textContent = copy[0];
  elements.voiceStatusTitle.textContent = overrideTitle || copy[1];
  elements.voiceStatusDetail.textContent = overrideDetail || copy[2];
  elements.spokenResponseStatus.textContent = overrideSpoken || copy[3];
  updateFlow(mode);
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 4200);
}

function clearVoiceError({ restoreStatus = false } = {}) {
  const hadError = Boolean(state.voiceError);
  state.voiceError = "";
  elements.voiceError.hidden = true;
  elements.voiceErrorMessage.textContent = "";
  if (restoreStatus && hadError) {
    setMode(state.recording ? (state.muted ? "muted" : "listening") : "ready");
  }
}

function showVoiceError(message) {
  const detail = String(message || "The NVIDIA voice service could not create this response.").trim();
  state.voiceError = detail;
  elements.voiceErrorMessage.textContent = detail;
  elements.voiceError.hidden = false;
  elements.stopVoiceButton.disabled = true;
  setMode("ready", "Voice response unavailable", detail, "Voice error");
  showToast(detail);
}

function applyVoiceCompatibility() {
  const speaker = elements.voiceSelect.value;
  const supported = new Set(
    state.voiceCatalog?.speakers?.[speaker]?.emotions || ["Neutral"],
  );
  Array.from(elements.emotionSelect.options).forEach((option) => {
    option.disabled = !supported.has(option.value);
    option.title = option.disabled
      ? `Not available for ${speaker}`
      : `${option.value} is available for ${speaker}`;
  });
  if (!supported.has(elements.emotionSelect.value)) {
    elements.emotionSelect.value = supported.has("Neutral")
      ? "Neutral"
      : Array.from(supported)[0];
  }
}

function syncContextControls() {
  const interactionBusy = state.contextBusy || state.chatBusy || state.recording;
  elements.contextDock.classList.toggle("active", state.contextActive);
  elements.contextUploadButton.disabled = interactionBusy;
  elements.contextClearButton.disabled = interactionBusy || !state.contextActive;
  elements.contextUploadLabel.textContent = state.contextBusy
    ? "Reading file..."
    : state.contextActive
      ? "Replace file"
      : "Upload context";
  elements.contextModeChip.textContent = state.contextActive ? "FILE-ONLY MODE" : "GENERAL KNOWLEDGE";

  if (state.contextActive) {
    elements.contextTitle.textContent = state.contextFilename;
    const truncation = state.contextTruncated ? " · first 120,000 characters used" : "";
    elements.contextDescription.textContent = `${state.contextCharacters.toLocaleString()} characters${truncation}. Answers are restricted to this file.`;
  } else {
    elements.contextTitle.textContent = "Optional reference file";
    elements.contextDescription.textContent = "No file selected. The agent can use its existing knowledge.";
  }
}

function syncControls() {
  elements.recordButtonLabel.textContent = state.recording ? "Stop recording" : "Start recording";
  applyIcon(
    elements.recordButton.querySelector(".material-symbols-rounded"),
    state.recording ? "stop" : "mic",
  );
  elements.micButton.setAttribute("aria-label", state.recording ? "Stop recording" : "Start recording");
  elements.muteButton.setAttribute("aria-pressed", String(state.muted));
  elements.muteButtonLabel.textContent = state.muted ? "Unmute input" : "Mute input";
  applyIcon(
    elements.muteButton.querySelector(".material-symbols-rounded"),
    state.muted ? "mic" : "mic_off",
  );
  elements.chatSendButton.disabled = state.chatBusy;
  syncContextControls();
}

function setTranscript(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  state.transcript = value;
  elements.voiceTranscript.textContent = value || "Your words will appear here as you speak.";
  elements.voiceTranscript.classList.toggle("placeholder", !value);
  const words = value ? value.split(/\s+/).length : 0;
  elements.transcriptWordCount.textContent = `${words} ${words === 1 ? "word" : "words"}`;
}

async function parseApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  let payload = null;
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }
  }
  if (!response.ok) {
    throw new Error(payload?.error || payload?.detail || `Request failed with status ${response.status}.`);
  }
  return payload;
}

function sendRTVI(type, data = null) {
  if (!state.dataChannel || state.dataChannel.readyState !== "open") return false;
  state.dataChannel.send(JSON.stringify({
    label: "rtvi-ai",
    type,
    id: crypto.randomUUID(),
    data,
  }));
  return true;
}

function waitForIceGathering(pc, timeoutMs = 10000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, timeoutMs);
    function done() {
      window.clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", changed);
      resolve();
    }
    function changed() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", changed);
  });
}

function waitForDataChannel(channel, timeoutMs = 15000) {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("The agent data channel timed out.")), timeoutMs);
    channel.addEventListener("open", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
    channel.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(new Error("The agent data channel could not be opened."));
    }, { once: true });
  });
}

function handleAgentMessage(event) {
  if (typeof event.data !== "string" || event.data.startsWith("ping")) return;
  let message;
  try {
    message = JSON.parse(event.data);
  } catch (_error) {
    return;
  }
  if (message.label !== "rtvi-ai") return;
  const data = message.data || {};

  switch (message.type) {
    case "bot-ready":
      state.agentConnected = true;
      if (state.recording) setMode(state.muted ? "muted" : "listening");
      break;
    case "user-started-speaking":
      if (state.recording && !state.muted) setMode("listening");
      break;
    case "user-transcription":
      if (data.text) {
        setTranscript(data.text);
        if (data.final) state.finalTranscript = data.text;
      }
      break;
    case "user-stopped-speaking":
    case "bot-llm-started":
      setMode("thinking");
      break;
    case "bot-tts-started":
      setMode("synthesizing");
      break;
    case "bot-started-speaking":
      if (!state.outputSuppressed) {
        elements.responseAudio.muted = false;
        elements.responseAudio.play().catch(() => undefined);
        elements.stopVoiceButton.disabled = false;
        setMode("speaking");
      }
      break;
    case "bot-stopped-speaking":
      elements.stopVoiceButton.disabled = true;
      state.outputSuppressed = false;
      elements.responseAudio.muted = false;
      if (!state.voiceError) {
        setMode(state.recording ? (state.muted ? "muted" : "listening") : "ready", "Response complete", "Start another recording whenever you are ready.", "Response complete");
      }
      break;
    case "server-message":
      if (data.type === "user-turn-finalized" && data.transcript) {
        state.finalTranscript = data.transcript;
        setTranscript(data.transcript);
      }
      break;
    case "error":
    case "error-response":
      showVoiceError(data.error || "The live agent reported an error.");
      break;
    default:
      break;
  }
}

function startAudioMeter(stream) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  state.audioContext = new AudioContext();
  const analyser = state.audioContext.createAnalyser();
  analyser.fftSize = 256;
  state.audioContext.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.frequencyBinCount);

  const draw = () => {
    analyser.getByteFrequencyData(samples);
    const average = samples.reduce((total, value) => total + value, 0) / samples.length;
    elements.voiceStage.style.setProperty("--level", Math.min(1, average / 70).toFixed(2));
    state.analyserFrame = window.requestAnimationFrame(draw);
  };
  draw();
}

function stopMediaStream() {
  if (state.analyserFrame) window.cancelAnimationFrame(state.analyserFrame);
  state.analyserFrame = null;
  elements.voiceStage.style.setProperty("--level", "0");
  if (state.audioContext) state.audioContext.close().catch(() => undefined);
  state.audioContext = null;
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
}

async function connectVoiceAgent() {
  if (state.agentConnected && state.peerConnection) return;
  setMode("connecting");

  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  startAudioMeter(state.stream);

  const pc = new RTCPeerConnection();
  const channel = pc.createDataChannel("rtvi-ai");
  state.peerConnection = pc;
  state.dataChannel = channel;
  channel.addEventListener("message", handleAgentMessage);

  const remoteStream = new MediaStream();
  state.remoteStream = remoteStream;
  elements.responseAudio.srcObject = remoteStream;
  elements.responseAudio.classList.add("visible");
  elements.responseAudio.autoplay = true;

  pc.addEventListener("track", (event) => {
    if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
      remoteStream.addTrack(event.track);
    }
    elements.responseAudio.play().catch(() => undefined);
  });
  pc.addEventListener("connectionstatechange", () => {
    if (["failed", "disconnected", "closed"].includes(pc.connectionState) && state.peerConnection === pc) {
      state.agentConnected = false;
      if (pc.connectionState === "failed") {
        setMode("ready", "Agent connection lost", "Start recording to open a new session.", "Disconnected");
        showToast("The live voice connection was interrupted.");
      }
    }
  });

  const track = state.stream.getAudioTracks()[0];
  pc.addTransceiver(track, { direction: "sendrecv" });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);

  const response = await fetch("/api/agent/offer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sdp: pc.localDescription.sdp,
      type: pc.localDescription.type,
      request_data: {
        language: elements.languageSelect.value,
        speaker: elements.voiceSelect.value,
        emotion: elements.emotionSelect.value,
        ...(state.contextActive ? { context_id: state.contextId } : {}),
      },
    }),
  });
  const answer = await parseApiResponse(response);
  await pc.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
  await waitForDataChannel(channel);

  sendRTVI("client-ready", {
    version: "1.4.0",
    about: {
      library: "voice-desk-native-webrtc",
      library_version: "1.0.0",
      platform: navigator.platform || "web",
    },
  });
  state.keepAliveTimer = window.setInterval(() => {
    if (channel.readyState === "open") channel.send(`ping-${Date.now()}`);
  }, 1000);
  state.agentConnected = true;
}

async function disconnectVoiceAgent({ notify = true } = {}) {
  if (notify) sendRTVI("disconnect-bot");
  if (state.keepAliveTimer) window.clearInterval(state.keepAliveTimer);
  state.keepAliveTimer = null;
  if (state.dataChannel) state.dataChannel.close();
  if (state.peerConnection) state.peerConnection.close();
  state.dataChannel = null;
  state.peerConnection = null;
  state.agentConnected = false;
  state.recording = false;
  state.outputSuppressed = false;
  elements.stopVoiceButton.disabled = true;
  elements.responseAudio.pause();
  elements.responseAudio.srcObject = null;
  elements.responseAudio.classList.remove("visible");
  state.remoteStream = null;
  stopMediaStream();
  syncControls();
}

async function startRecording() {
  clearVoiceError();
  if (!state.voiceApiReady) {
    showToast("Add a valid NVIDIA_BUILD_API_KEY to .env, then restart the app.");
    return;
  }
  if (!state.agentAvailable) {
    showToast("The native voice-agent runtime is unavailable. Restart Voice Desk.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    showToast("This browser cannot open a WebRTC microphone session. Use current Chrome or Edge.");
    return;
  }
  if (state.muted) {
    setMode("muted");
    showToast("Unmute voice input before starting the microphone.");
    return;
  }

  state.outputSuppressed = false;
  elements.responseAudio.muted = false;
  state.recording = true;
  syncControls();
  try {
    await connectVoiceAgent();
    state.stream.getAudioTracks().forEach((track) => { track.enabled = true; });
    elements.responseAudio.play().catch(() => undefined);
    setMode("listening");
  } catch (error) {
    await disconnectVoiceAgent({ notify: false });
    setMode("ready", "The voice agent could not connect", error.message, "Connection unavailable");
    showToast(error.message);
  }
}

function stopRecording() {
  state.recording = false;
  if (state.stream) state.stream.getAudioTracks().forEach((track) => { track.enabled = false; });
  syncControls();
  setMode("thinking", "Finishing your turn", "NVIDIA ASR is finalizing the transcription...", "Waiting for the agent");
}

function toggleRecording() {
  if (state.recording) stopRecording();
  else startRecording();
}

function toggleMute() {
  state.muted = !state.muted;
  if (state.stream) {
    state.stream.getAudioTracks().forEach((track) => {
      track.enabled = state.recording && !state.muted;
    });
  }
  setMode(state.muted ? "muted" : state.recording ? "listening" : "ready");
  syncControls();
}

function stopSpokenResponse({ quiet = false } = {}) {
  if (!state.agentConnected) return;
  sendRTVI("client-message", { t: "stop-response", d: {} });
  state.outputSuppressed = true;
  elements.responseAudio.muted = true;
  elements.stopVoiceButton.disabled = true;
  setMode(state.recording ? "listening" : "ready", "Spoken response stopped", "Start recording whenever you are ready.", "Stopped");
  if (!quiet) showToast("Spoken response stopped.");
}

async function resetVoiceSession({ quiet = false } = {}) {
  await disconnectVoiceAgent();
  clearVoiceError();
  state.finalTranscript = "";
  setTranscript("");
  setMode(state.muted ? "muted" : "ready");
  if (!quiet) showToast("Started a new voice-agent session.");
}

async function switchTab(tabName) {
  if (tabName === state.activeTab) return;
  if (tabName === "chat" && state.peerConnection) await resetVoiceSession({ quiet: true });
  state.activeTab = tabName;
  const voiceActive = tabName === "voice";
  elements.voiceTab.classList.toggle("active", voiceActive);
  elements.chatTab.classList.toggle("active", !voiceActive);
  elements.voiceTab.setAttribute("aria-selected", String(voiceActive));
  elements.chatTab.setAttribute("aria-selected", String(!voiceActive));
  elements.voiceTabPanel.hidden = !voiceActive;
  elements.chatTabPanel.hidden = voiceActive;
  window.requestAnimationFrame(() => {
    if (!voiceActive) elements.chatInput.focus();
  });
}

function scrollChat() {
  window.requestAnimationFrame(() => {
    elements.chatConversationFeed.scrollTop = elements.chatConversationFeed.scrollHeight;
  });
}

function removeChatWelcome() {
  document.querySelector("#chatWelcomeMessage")?.remove();
}

function appendChatMessage(role, content) {
  removeChatWelcome();
  const row = document.createElement("article");
  row.className = `message-row ${role}`;
  row.setAttribute("aria-label", role === "user" ? "You said" : "Voice Desk replied");
  if (role === "assistant") {
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    const icon = document.createElement("span");
    icon.className = "material-symbols-rounded";
    applyIcon(icon, "chat");
    avatar.append(icon);
    row.append(avatar);
  }
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = content;
  row.append(bubble);
  elements.chatConversationFeed.append(row);
  scrollChat();
  return row;
}

function appendTypingIndicator() {
  removeChatWelcome();
  const row = document.createElement("article");
  row.className = "message-row assistant";
  row.id = "typingIndicator";
  row.setAttribute("aria-label", "Voice Desk is thinking");
  const avatar = document.createElement("span");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  const icon = document.createElement("span");
  icon.className = "material-symbols-rounded";
  applyIcon(icon, "chat");
  avatar.append(icon);
  const bubble = document.createElement("div");
  bubble.className = "message-bubble typing-bubble";
  for (let index = 0; index < 3; index += 1) bubble.append(document.createElement("span"));
  row.append(avatar, bubble);
  elements.chatConversationFeed.append(row);
  scrollChat();
  return row;
}

async function sendChatMessage() {
  const message = elements.chatInput.value.trim();
  if (!message || state.chatBusy) return;
  if (!state.chatApiReady) {
    showToast("Add a valid NVIDIA_API_KEY to .env, then restart the app.");
    return;
  }
  const priorHistory = state.chatConversation.slice(-10);
  state.chatConversation.push({ role: "user", content: message });
  appendChatMessage("user", message);
  elements.chatInput.value = "";
  state.chatBusy = true;
  syncControls();
  const typing = appendTypingIndicator();
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: priorHistory,
        ...(state.contextActive ? { context_id: state.contextId } : {}),
      }),
    });
    const chat = await parseApiResponse(response);
    typing.remove();
    state.chatConversation.push({ role: "assistant", content: chat.answer });
    appendChatMessage("assistant", chat.answer);
  } catch (error) {
    typing.remove();
    appendChatMessage("assistant", `I couldn't complete that request. ${error.message}`);
    showToast(error.message);
  } finally {
    state.chatBusy = false;
    syncControls();
  }
}

function resetChat({ quiet = false } = {}) {
  state.chatConversation = [];
  elements.chatInput.value = "";
  elements.chatConversationFeed.innerHTML = `
    <article class="welcome-message" id="chatWelcomeMessage">
      <div class="assistant-avatar" aria-hidden="true"><span class="material-symbols-rounded">chat</span></div>
      <div>
        <span class="message-label">VOICE DESK CHAT</span>
        <h3>Fresh chat. What would you like to explore?</h3>
        <p>This tab keeps the full written conversation visible. Voice playback stays in Voice conversation.</p>
        <div class="suggestions" aria-label="Suggested questions">
          <button type="button" data-chat-prompt="Summarize three priorities for a productive workday.">Plan my priorities</button>
          <button type="button" data-chat-prompt="Give me a concise update I can use to open a project meeting.">Draft a meeting opener</button>
          <button type="button" data-chat-prompt="Explain generative AI in simple business terms.">Explain a concept</button>
        </div>
      </div>
    </article>`;
  hydrateIcons(elements.chatConversationFeed);
  if (!quiet) showToast("Started a new text chat.");
}

async function resetConversationsForContextChange() {
  await resetVoiceSession({ quiet: true });
  resetChat({ quiet: true });
}

async function uploadContextFile(file) {
  if (!file || state.contextBusy) return;
  if (file.size > 50 * 1024 * 1024) {
    showToast("Choose a context file that is 50 MB or smaller.");
    return;
  }

  state.contextBusy = true;
  syncControls();
  try {
    const response = await fetch("/api/context", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Context-ID": state.contextId,
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
    const uploaded = await parseApiResponse(response);
    state.contextActive = true;
    state.contextFilename = uploaded.filename;
    state.contextCharacters = uploaded.characters;
    state.contextTruncated = Boolean(uploaded.truncated);
    await resetConversationsForContextChange();
    showToast(`${uploaded.filename} is now the agent's only answer source.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.contextBusy = false;
    elements.contextFileInput.value = "";
    syncControls();
  }
}

async function clearContextFile() {
  if (!state.contextActive || state.contextBusy) return;
  state.contextBusy = true;
  syncControls();
  try {
    const response = await fetch("/api/context", {
      method: "DELETE",
      headers: { "X-Context-ID": state.contextId },
    });
    await parseApiResponse(response);
    state.contextActive = false;
    state.contextFilename = "";
    state.contextCharacters = 0;
    state.contextTruncated = false;
    await resetConversationsForContextChange();
    showToast("Context file cleared. General knowledge is available again.");
  } catch (error) {
    showToast(error.message);
  } finally {
    state.contextBusy = false;
    syncControls();
  }
}

async function handleVoiceSettingsChange() {
  applyVoiceCompatibility();
  clearVoiceError();
  if (state.peerConnection) {
    await resetVoiceSession({ quiet: true });
  }
  const language = elements.languageSelect.selectedOptions[0]?.textContent.split("·")[0].trim();
  showToast(`${language}, ${elements.voiceSelect.value}, ${elements.emotionSelect.value} selected.`);
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const health = await parseApiResponse(response);
    state.chatApiReady = health.api_key_configured;
    state.voiceApiReady = health.voice_agent?.api_key_configured === true;
    state.agentAvailable = health.voice_agent?.status === "ready";
    state.voiceCatalog = health.voice_catalog || null;
    applyVoiceCompatibility();
    const connected = state.voiceApiReady && state.agentAvailable;
    elements.connectionChip.classList.toggle("needs-setup", !connected);
    elements.connectionLabel.textContent = connected ? "Voice agent ready" : state.voiceApiReady ? "Agent unavailable" : "API key needed";
    if (!state.voiceApiReady) {
      elements.voiceStatusDetail.textContent = "Add NVIDIA_BUILD_API_KEY to .env to enable streaming voice.";
    } else if (!state.agentAvailable) {
      elements.voiceStatusDetail.textContent = "Restart Voice Desk to start the native Pipecat runtime.";
    }
  } catch (_error) {
    elements.connectionChip.classList.add("needs-setup");
    elements.connectionLabel.textContent = "Service unavailable";
  }
}

elements.voiceTab.addEventListener("click", () => switchTab("voice"));
elements.chatTab.addEventListener("click", () => switchTab("chat"));
elements.micButton.addEventListener("click", toggleRecording);
elements.recordButton.addEventListener("click", toggleRecording);
elements.muteButton.addEventListener("click", toggleMute);
elements.stopVoiceButton.addEventListener("click", () => stopSpokenResponse());
elements.voiceErrorClose.addEventListener("click", () => clearVoiceError({ restoreStatus: true }));
elements.resetVoiceButton.addEventListener("click", () => resetVoiceSession());
elements.resetChatButton.addEventListener("click", () => resetChat());
elements.chatSendButton.addEventListener("click", sendChatMessage);
elements.languageSelect.addEventListener("change", handleVoiceSettingsChange);
elements.voiceSelect.addEventListener("change", handleVoiceSettingsChange);
elements.emotionSelect.addEventListener("change", handleVoiceSettingsChange);
elements.contextUploadButton.addEventListener("click", () => elements.contextFileInput.click());
elements.contextFileInput.addEventListener("change", () => {
  const [file] = elements.contextFileInput.files;
  uploadContextFile(file);
});
elements.contextClearButton.addEventListener("click", clearContextFile);

elements.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendChatMessage();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (state.recording) stopRecording();
  else if (!elements.stopVoiceButton.disabled) stopSpokenResponse();
});

elements.chatConversationFeed.addEventListener("click", (event) => {
  const suggestion = event.target.closest("[data-chat-prompt]");
  if (!suggestion) return;
  elements.chatInput.value = suggestion.dataset.chatPrompt;
  elements.chatInput.focus();
});

elements.themeInfoButton.addEventListener("click", () => elements.aboutDialog.showModal());
elements.dialogCloseButton.addEventListener("click", () => elements.aboutDialog.close());
elements.dialogDoneButton.addEventListener("click", () => elements.aboutDialog.close());
window.addEventListener("beforeunload", () => {
  sendRTVI("disconnect-bot");
  if (state.peerConnection) state.peerConnection.close();
});

syncControls();
setTranscript("");
loadHealth();
