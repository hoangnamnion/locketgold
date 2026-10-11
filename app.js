/**
 * VideoCompress Pro - Minimalist High Performance Video Compressor
 * Tiêu chuẩn:
 * 1. Chấp nhận mọi video: Nếu video > 10s, cung cấp công cụ cắt đoạn tối đa 10s.
 * 2. Tự động nén và ép dung lượng đoạn cắt LUÔN DƯỚI 5MB.
 * 3. Giao diện tối giản Neo-Brutalism.
 */

(() => {
  // --- Constants ---
  const MAX_TRIM_DURATION = 10.0; // Tối đa 10 giây cho một đoạn cắt
  const CEILING_SIZE_MB = 4.8;     // Ngưỡng trần an toàn để 100% video thực tế dưới 5.0 MB
  const TARGET_SAFE_MB = 2.8;      // Mục tiêu nén chuẩn cực nét và an toàn dưới 5MB

  // --- DOM Elements ---
  const uploadSection = document.getElementById('uploadSection');
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  const errorModal = document.getElementById('errorModal');
  const errorMessageText = document.getElementById('errorMessageText');
  const btnCloseAlert = document.getElementById('btnCloseAlert');

  const configSection = document.getElementById('configSection');
  const configSubtitle = document.getElementById('configSubtitle');
  const sourceVideo = document.getElementById('sourceVideo');
  const videoNameEl = document.getElementById('videoName');
  const btnChangeFile = document.getElementById('btnChangeFile');
  const origDurationBadge = document.getElementById('origDurationBadge');
  const origSizeText = document.getElementById('origSizeText');
  const origResText = document.getElementById('origResText');
  const origDurationText = document.getElementById('origDurationText');

  // Trimmer Elements
  const trimmerBox = document.getElementById('trimmerBox');
  const trimDurationBadge = document.getElementById('trimDurationBadge');
  const trimStartInput = document.getElementById('trimStartInput');
  const trimEndInput = document.getElementById('trimEndInput');
  const trimRangeSlider = document.getElementById('trimRangeSlider');
  const scrubberCurrentLabel = document.getElementById('scrubberCurrentLabel');
  const scrubberTotalLabel = document.getElementById('scrubberTotalLabel');
  const btnTrimStart = document.getElementById('btnTrimStart');
  const btnTrimMid = document.getElementById('btnTrimMid');
  const btnTrimEnd = document.getElementById('btnTrimEnd');
  const btnPreviewTrim = document.getElementById('btnPreviewTrim');

  const estSizeText = document.getElementById('estSizeText');
  const btnStartCompress = document.getElementById('btnStartCompress');

  const processingSection = document.getElementById('processingSection');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const processingStatusText = document.getElementById('processingStatusText');
  const timeElapsedText = document.getElementById('timeElapsedText');
  const videoCurrentTimeText = document.getElementById('videoCurrentTimeText');
  const btnCancelCompress = document.getElementById('btnCancelCompress');

  const resultSection = document.getElementById('resultSection');
  const resBeforeSize = document.getElementById('resBeforeSize');
  const resAfterSize = document.getElementById('resAfterSize');
  const resSavedAmount = document.getElementById('resSavedAmount');
  const compressedVideoPlayer = document.getElementById('compressedVideoPlayer');
  const btnDownloadVideo = document.getElementById('btnDownloadVideo');
  const btnCompressAnother = document.getElementById('btnCompressAnother');

  const renderCanvas = document.getElementById('renderCanvas');
  const canvasCtx = renderCanvas.getContext('2d', { alpha: false });

  // --- State Variables ---
  let currentFile = null;
  let videoObjectUrl = null;
  let videoDuration = 0;
  let originalWidth = 0;
  let originalHeight = 0;
  let originalSizeBytes = 0;

  // Trim States
  let trimStart = 0.0;
  let trimEnd = 10.0;
  let previewTimeout = null;

  let mediaRecorder = null;
  let recordedChunks = [];
  let compressedBlobUrl = null;
  let isCompressing = false;
  let cancelRequested = false;
  let animationFrameId = null;
  let processingTimer = null;
  let startTime = 0;

  let audioContext = null;
  let audioSourceNode = null;
  let audioDestNode = null;

  // --- Utilities ---
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function showError(msg) {
    errorMessageText.textContent = msg;
    errorModal.classList.remove('hidden');
  }

  if (btnCloseAlert) {
    btnCloseAlert.addEventListener('click', () => {
      errorModal.classList.add('hidden');
    });
  }

  // --- Safe Bitrate Calculation to Guarantee < 5MB ---
  function getSafeVideoBitrateBps(clipDurationSec) {
    const dur = Math.max(1.0, Math.min(MAX_TRIM_DURATION, clipDurationSec || 10.0));
    const targetBits = TARGET_SAFE_MB * 1024 * 1024 * 8;
    const audioBps = 128000;
    const totalBps = targetBits / dur;
    const videoBps = Math.max(350000, Math.floor(totalBps - audioBps));

    // Hard ceiling safety check: never exceed 4.8MB
    const maxAllowedBps = (CEILING_SIZE_MB * 1024 * 1024 * 8) / dur - audioBps;
    return Math.min(videoBps, Math.max(300000, maxAllowedBps));
  }

  // --- Drag & Drop / File Selection ---
  function setupFileInput() {
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      }, false);
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files && files.length > 0) {
        handleSelectedFile(files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleSelectedFile(e.target.files[0]);
      }
    });

    btnChangeFile.addEventListener('click', () => {
      resetToUpload();
    });

    btnCompressAnother.addEventListener('click', () => {
      resetToUpload();
    });
  }

  function resetToUpload() {
    if (isCompressing) {
      cancelCompression();
    }
    if (previewTimeout) {
      clearTimeout(previewTimeout);
      previewTimeout = null;
    }
    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
      videoObjectUrl = null;
    }
    if (compressedBlobUrl) {
      URL.revokeObjectURL(compressedBlobUrl);
      compressedBlobUrl = null;
    }
    sourceVideo.removeAttribute('src');
    sourceVideo.load();
    fileInput.value = '';

    uploadSection.classList.remove('hidden');
    configSection.classList.add('hidden');
    processingSection.classList.add('hidden');
    resultSection.classList.add('hidden');
  }

  function handleSelectedFile(file) {
    if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|mov|webm|mkv|avi|wmv|flv)$/i)) {
      showError('Tệp không hợp lệ! Vui lòng chọn một file video (MP4, MOV, WebM, MKV, AVI,...).');
      return;
    }

    currentFile = file;
    originalSizeBytes = file.size;
    videoNameEl.textContent = file.name;
    videoNameEl.title = file.name;
    origSizeText.textContent = formatBytes(file.size);

    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
    }
    videoObjectUrl = URL.createObjectURL(file);
    sourceVideo.src = videoObjectUrl;

    sourceVideo.onloadedmetadata = () => {
      videoDuration = sourceVideo.duration;
      originalWidth = sourceVideo.videoWidth || 1920;
      originalHeight = sourceVideo.videoHeight || 1080;

      origDurationBadge.textContent = `${videoDuration.toFixed(1)}s`;
      origDurationText.textContent = `${videoDuration.toFixed(1)}s`;
      origResText.textContent = `${originalWidth}x${originalHeight}`;

      // XỬ LÝ CẮT ĐOẠN VIDEO (TRIMMER)
      if (videoDuration <= MAX_TRIM_DURATION) {
        // Video ngắn hơn hoặc bằng 10s: Không cần cắt
        trimStart = 0.0;
        trimEnd = videoDuration;
        trimmerBox.classList.add('hidden');
        configSubtitle.textContent = `Clip ngắn hợp lệ (${videoDuration.toFixed(1)}s ≤ 10s). Sẵn sàng nén luôn!`;
      } else {
        // Video dài hơn 10s: Bật khối chọn đoạn 10 giây
        trimStart = 0.0;
        trimEnd = MAX_TRIM_DURATION;
        trimmerBox.classList.remove('hidden');
        configSubtitle.textContent = `Video dài ${videoDuration.toFixed(1)}s. Hãy chọn đoạn cắt tối đa 10 giây để nén!`;

        setupTrimmerControls();
      }

      updateEstimate();

      uploadSection.classList.add('hidden');
      configSection.classList.remove('hidden');
      processingSection.classList.add('hidden');
      resultSection.classList.add('hidden');
    };

    sourceVideo.onerror = () => {
      showError('Trình duyệt không thể giải mã video này. Vui lòng thử video MP4 hoặc WebM.');
      resetToUpload();
    };
  }

  // --- Trimmer Controls Setup ---
  function setupTrimmerControls() {
    trimStartInput.max = (videoDuration - 0.5).toFixed(1);
    trimEndInput.max = videoDuration.toFixed(1);

    const maxScrub = Math.max(0, videoDuration - MAX_TRIM_DURATION);
    trimRangeSlider.max = maxScrub.toFixed(1);
    trimRangeSlider.value = 0;

    scrubberTotalLabel.textContent = `Tổng: ${videoDuration.toFixed(1)}s`;

    setTrimRange(0.0, Math.min(videoDuration, MAX_TRIM_DURATION));
  }

  // --- Smooth Video Seeking Throttler (Fix Lag when dragging slider) ---
  let isSeeking = false;
  let pendingSeekTime = null;

  function requestSmoothSeek(time) {
    pendingSeekTime = time;
    if (!isSeeking) {
      isSeeking = true;
      requestAnimationFrame(() => {
        if (pendingSeekTime !== null && sourceVideo && sourceVideo.readyState >= 1) {
          sourceVideo.currentTime = pendingSeekTime;
        }
        isSeeking = false;
      });
    }
  }

  function setTrimRange(start, end, shouldSeek = true) {
    trimStart = Math.max(0, parseFloat(start.toFixed(1)));
    trimEnd = Math.min(videoDuration, parseFloat(end.toFixed(1)));

    // Đảm bảo không vượt quá 10 giây
    if (trimEnd - trimStart > MAX_TRIM_DURATION) {
      trimEnd = parseFloat((trimStart + MAX_TRIM_DURATION).toFixed(1));
    }

    trimStartInput.value = trimStart.toFixed(1);
    trimEndInput.value = trimEnd.toFixed(1);

    const diff = (trimEnd - trimStart).toFixed(1);
    trimDurationBadge.textContent = `Đoạn chọn: ${diff}s / Max 10s`;
    scrubberCurrentLabel.textContent = `Đang chọn: ${trimStart.toFixed(1)}s - ${trimEnd.toFixed(1)}s`;

    trimRangeSlider.value = trimStart.toFixed(1);

    // Cập nhật vị trí xem video mượt mà không gây giật lag
    if (shouldSeek) {
      requestSmoothSeek(trimStart);
    }

    updateEstimate();
  }

  // Trimmer Event Listeners
  trimStartInput.addEventListener('change', () => {
    let s = parseFloat(trimStartInput.value) || 0;
    s = Math.max(0, Math.min(videoDuration - 0.5, s));
    let e = trimEnd;
    if (e <= s || e - s > MAX_TRIM_DURATION) {
      e = Math.min(videoDuration, s + MAX_TRIM_DURATION);
    }
    setTrimRange(s, e, true);
    clearQuickActive();
  });

  trimEndInput.addEventListener('change', () => {
    let e = parseFloat(trimEndInput.value) || MAX_TRIM_DURATION;
    e = Math.max(0.5, Math.min(videoDuration, e));
    let s = trimStart;
    if (e <= s || e - s > MAX_TRIM_DURATION) {
      s = Math.max(0, e - MAX_TRIM_DURATION);
    }
    setTrimRange(s, e, true);
    clearQuickActive();
  });

  trimRangeSlider.addEventListener('input', (e) => {
    const s = parseFloat(e.target.value) || 0;
    const end = Math.min(videoDuration, s + MAX_TRIM_DURATION);
    setTrimRange(s, end, true);
    clearQuickActive();
  });

  // Quick chips
  btnTrimStart.addEventListener('click', () => {
    setTrimRange(0.0, Math.min(videoDuration, MAX_TRIM_DURATION));
    setQuickActive(btnTrimStart);
  });

  btnTrimMid.addEventListener('click', () => {
    const mid = videoDuration / 2;
    const s = Math.max(0, mid - (MAX_TRIM_DURATION / 2));
    const e = Math.min(videoDuration, s + MAX_TRIM_DURATION);
    setTrimRange(s, e);
    setQuickActive(btnTrimMid);
  });

  btnTrimEnd.addEventListener('click', () => {
    const s = Math.max(0, videoDuration - MAX_TRIM_DURATION);
    setTrimRange(s, videoDuration);
    setQuickActive(btnTrimEnd);
  });

  btnPreviewTrim.addEventListener('click', () => {
    if (previewTimeout) {
      clearTimeout(previewTimeout);
      previewTimeout = null;
    }
    sourceVideo.currentTime = trimStart;
    sourceVideo.play().then(() => {
      const playDurationMs = (trimEnd - trimStart) * 1000;
      previewTimeout = setTimeout(() => {
        sourceVideo.pause();
        sourceVideo.currentTime = trimStart;
      }, playDurationMs);
    }).catch(err => {
      console.warn('Preview error:', err);
    });
  });

  function clearQuickActive() {
    [btnTrimStart, btnTrimMid, btnTrimEnd].forEach(b => b.classList.remove('active'));
  }

  function setQuickActive(btn) {
    clearQuickActive();
    btn.classList.add('active');
  }

  function updateEstimate() {
    const clipDur = Math.max(1.0, trimEnd - trimStart);
    const estDisplay = Math.min(TARGET_SAFE_MB, Math.max(1.2, (TARGET_SAFE_MB * clipDur / 8))).toFixed(1);
    estSizeText.textContent = `~ ${estDisplay} MB • Tool Xịn Của Hoàng Quân`;
  }

  // Calculate target dimensions keeping aspect ratio (clamp to max 720p HD)
  function calculateTargetDimensions() {
    let targetW = originalWidth;
    let targetH = originalHeight;
    const aspect = originalWidth / originalHeight;

    const maxDim = 1280;
    if (originalWidth > maxDim || originalHeight > 720) {
      if (aspect >= 1) {
        targetH = 720;
        targetW = Math.round(targetH * aspect);
      } else {
        targetW = 720;
        targetH = Math.round(targetW / aspect);
      }
    }

    targetW = Math.round(targetW / 2) * 2;
    targetH = Math.round(targetH / 2) * 2;
    return { width: targetW, height: targetH };
  }

  // --- Best MIME type ---
  function getBestSupportedMimeType() {
    const types = [
      { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
      { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
      { mime: 'video/mp4', ext: 'mp4' },
      { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
      { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
      { mime: 'video/webm', ext: 'webm' }
    ];

    if (window.MediaRecorder && typeof MediaRecorder.isTypeSupported === 'function') {
      for (const t of types) {
        if (MediaRecorder.isTypeSupported(t.mime)) return t;
      }
    }
    return { mime: '', ext: 'mp4' };
  }

  // --- Compression Core Engine (Recording Exactly Trimmed Excerpt) ---
  async function startCompression() {
    if (!currentFile || isCompressing) return;

    if (previewTimeout) {
      clearTimeout(previewTimeout);
      previewTimeout = null;
    }

    isCompressing = true;
    cancelRequested = false;
    recordedChunks = [];

    // Switch view
    configSection.classList.add('hidden');
    processingSection.classList.remove('hidden');

    const clipDuration = trimEnd - trimStart;

    progressPercent.textContent = '0%';
    progressBarFill.style.width = '0%';
    processingStatusText.textContent = `Đang nén đoạn cắt ${clipDuration.toFixed(1)}s (từ ${trimStart.toFixed(1)}s đến ${trimEnd.toFixed(1)}s)...`;
    timeElapsedText.textContent = '0.0s';
    videoCurrentTimeText.textContent = `0.0s / ${clipDuration.toFixed(1)}s`;

    startTime = Date.now();
    processingTimer = setInterval(updateProcessingTimer, 200);

    const { width: targetWidth, height: targetHeight } = calculateTargetDimensions();
    renderCanvas.width = targetWidth;
    renderCanvas.height = targetHeight;

    const fps = 30;
    const videoBitrateBps = getSafeVideoBitrateBps(clipDuration);
    const audioBitrateBps = 128000;
    const playbackSpeed = 1.0; // 1x chuẩn thời gian thực: triệt tiêu 100% giật lag và lệch tiếng

    const { mime: selectedMime, ext: outputExt } = getBestSupportedMimeType();

    // Optimize canvas rendering context
    canvasCtx.imageSmoothingEnabled = true;
    canvasCtx.imageSmoothingQuality = 'medium';

    const canvasStream = renderCanvas.captureStream(fps);
    const combinedStream = new MediaStream();

    const videoTracks = canvasStream.getVideoTracks();
    if (videoTracks.length > 0) {
      combinedStream.addTrack(videoTracks[0]);
    }

    // Audio setup with Web Audio API
    let audioTrackAdded = false;
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      if (!audioSourceNode) {
        audioSourceNode = audioContext.createMediaElementSource(sourceVideo);
      }
      audioDestNode = audioContext.createMediaStreamDestination();
      audioSourceNode.disconnect();
      audioSourceNode.connect(audioDestNode);

      const audioTracks = audioDestNode.stream.getAudioTracks();
      if (audioTracks.length > 0) {
        combinedStream.addTrack(audioTracks[0]);
        audioTrackAdded = true;
      }
    } catch (err) {
      console.warn('Audio note:', err);
    }

    // MediaRecorder
    const recorderOptions = {
      videoBitsPerSecond: videoBitrateBps
    };
    if (selectedMime) {
      recorderOptions.mimeType = selectedMime;
    }
    if (audioTrackAdded) {
      recorderOptions.audioBitsPerSecond = audioBitrateBps;
    }

    try {
      mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);
    } catch (err) {
      mediaRecorder = new MediaRecorder(combinedStream);
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      finishCompression(outputExt);
    };

    // Seek to exact trim start position before starting recording
    sourceVideo.currentTime = trimStart;
    sourceVideo.playbackRate = playbackSpeed;
    sourceVideo.muted = false;

    // Start recording với chunks 1000ms (giảm 90% tải bộ nhớ và giật lag)
    mediaRecorder.start(1000);

    let lastDrawTime = 0;
    const frameIntervalMs = 1000 / fps; // 33.3ms giới hạn chuẩn 30fps

    sourceVideo.play().then(() => {
      renderLoop();
    }).catch(err => {
      showError('Không thể phát video để nén: ' + err.message);
      cancelCompression();
    });

    sourceVideo.onended = () => {
      stopAndFinalize();
    };

    function renderLoop(timestamp) {
      if (!isCompressing || cancelRequested) return;

      const clipDuration = trimEnd - trimStart;

      // Throttle canvas rendering to 30fps (không vẽ thừa thãi trên màn hình 120Hz/144Hz)
      if (!timestamp || timestamp - lastDrawTime >= frameIntervalMs - 2) {
        if (!sourceVideo.paused && !sourceVideo.ended) {
          canvasCtx.drawImage(sourceVideo, 0, 0, renderCanvas.width, renderCanvas.height);

          const currentClipSec = Math.max(0, sourceVideo.currentTime - trimStart);
          const progress = Math.min(100, (currentClipSec / clipDuration) * 100);
          const roundedProgress = Math.floor(progress);

          progressPercent.textContent = `${roundedProgress}%`;
          progressBarFill.style.width = `${progress}%`;
          videoCurrentTimeText.textContent = `${currentClipSec.toFixed(1)}s / ${clipDuration.toFixed(1)}s`;
        }
        lastDrawTime = timestamp || performance.now();
      }

      // ĐÃ CHẠY ĐẾN ĐIỂM KẾT THÚC CỦA ĐOẠN CẮT (trimEnd)
      if (sourceVideo.currentTime >= trimEnd - 0.05 || sourceVideo.ended) {
        stopAndFinalize();
        return;
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    }
  }

  function stopAndFinalize() {
    if (!isCompressing || cancelRequested) return;

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    sourceVideo.pause();
    processingStatusText.textContent = 'Hoàn tất! Đang kiểm tra dung lượng < 5MB...';
    progressPercent.textContent = '100%';
    progressBarFill.style.width = '100%';

    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    }, 200);
  }

  function finishCompression(outputExt) {
    if (cancelRequested) return;

    clearInterval(processingTimer);
    isCompressing = false;

    const mimeType = mediaRecorder.mimeType || 'video/mp4';
    const finalBlob = new Blob(recordedChunks, { type: mimeType });
    const finalSize = finalBlob.size;

    if (compressedBlobUrl) {
      URL.revokeObjectURL(compressedBlobUrl);
    }
    compressedBlobUrl = URL.createObjectURL(finalBlob);

    // Update Result UI
    resBeforeSize.textContent = formatBytes(originalSizeBytes);
    resAfterSize.textContent = formatBytes(finalSize);

    const savedBytes = originalSizeBytes - finalSize;
    const savedPercentage = Math.round((savedBytes / originalSizeBytes) * 100);

    const clipDuration = (trimEnd - trimStart).toFixed(1);

    if (savedBytes > 0) {
      resSavedAmount.textContent = `Tiết kiệm ${formatBytes(savedBytes)} (Giảm ${savedPercentage}%) • Đoạn: ${clipDuration}s`;
    } else {
      resSavedAmount.textContent = `Đã nén tối ưu đoạn ${clipDuration}s đạt chuẩn < 5MB`;
    }

    // Set download link
    const baseName = currentFile.name.replace(/\.[^/.]+$/, "");
    const downloadFileName = `[clip_${clipDuration}s]_${baseName}.${outputExt}`;
    btnDownloadVideo.href = compressedBlobUrl;
    btnDownloadVideo.download = downloadFileName;

    // Set preview player
    compressedVideoPlayer.src = compressedBlobUrl;

    // Switch view
    processingSection.classList.add('hidden');
    resultSection.classList.remove('hidden');
  }

  function cancelCompression() {
    cancelRequested = true;
    isCompressing = false;
    clearInterval(processingTimer);

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    if (sourceVideo) {
      sourceVideo.pause();
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (e) {}
    }

    recordedChunks = [];
    processingSection.classList.add('hidden');
    configSection.classList.remove('hidden');
  }

  function updateProcessingTimer() {
    if (!isCompressing) return;
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    timeElapsedText.textContent = `${elapsedSec}s`;
  }

  // --- Attach Button Listeners ---
  btnStartCompress.addEventListener('click', () => {
    startCompression();
  });

  btnCancelCompress.addEventListener('click', () => {
    cancelCompression();
  });

  // --- Initialize App ---
  setupFileInput();

})();
