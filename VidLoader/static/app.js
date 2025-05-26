document.addEventListener('DOMContentLoaded', async function() {
    const socket = io();
    const downloadBtn = document.getElementById('download-btn');
    const videoUrlInput = document.getElementById('video-url');
    const activeDownloadsContainer = document.getElementById('active-downloads');
    const downloadHistoryContainer = document.getElementById('download-history');
    const historyCountBadge = document.getElementById('history-count');
    const resolutionSelect = document.getElementById('resolution-select');

    // Test server connectivity
    try {
        console.log('Testing server connectivity...');
        const response = await fetch('/api/test');
        const data = await response.json();
        console.log('Server test response:', data);
    } catch (error) {
        console.error('Server connectivity test failed:', error);
        showError('Server connection failed. Please refresh the page.');
    }

    function showError(message, duration = 5000) {
        const errorContainer = document.getElementById('error-container');
        const errorMessage = document.getElementById('error-message');
        
        errorMessage.textContent = message;
        errorContainer.classList.remove('d-none');
        
        setTimeout(() => {
            errorContainer.classList.add('d-none');
        }, duration);
    }

    // Socket connection status logging
    socket.on('connect', () => {
        console.log('Socket.IO connected');
    });

    socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
        showError('Connection to server lost. Please refresh the page.');
    });

    socket.on('disconnect', (reason) => {
        console.log('Socket.IO disconnected:', reason);
    });

    // Load existing downloads on page load
    fetchDownloadHistory();

    // Socket event listeners
    socket.on('download_progress', function(data) {
        console.log('Progress update:', data);
        if (data.video_id && data.progress) {
            updateDownloadProgress(data.video_id, {
                ...data.progress,
                status: 'Downloading'
            });
        }
    });

    socket.on('download_complete', function(videoInfo) {
        console.log('Download complete:', videoInfo);
        const downloadElement = document.getElementById(`download-${videoInfo.id}`);
        if (downloadElement) {
            updateDownloadProgress(videoInfo.id, {
                progress: 100,
                status: 'Complete',
                title: videoInfo.title
            });
            
            // Remove from active downloads after a delay and refresh history
            setTimeout(() => {
                downloadElement.remove();
                fetchDownloadHistory();  // Refresh the download history
            }, 3000);
        }
    });

    socket.on('download_error', function(data) {
        console.error('Download error:', data);
        const downloadItem = document.getElementById(`download-${data.video_id}`);
        if (downloadItem) {
            downloadItem.querySelector('.badge').textContent = 'Error';
            downloadItem.querySelector('.progress-bar').classList.add('bg-danger');
        }
        showError(data.error);
    });

    downloadBtn.addEventListener('click', async function() {
        const url = videoUrlInput.value.trim();
        const resolution = resolutionSelect.value;
        
        if (!url) {
            showError('Please enter a video URL');
            return;
        }
        
        try {
            downloadBtn.disabled = true;
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url, resolution })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                console.log('Download started:', data);
                // Create initial progress element
                updateDownloadProgress(data.video_id, {
                    title: data.title,
                    progress: 0,
                    status: 'Starting download...'
                });
            } else {
                showError(data.error || 'Failed to start download');
            }
        } catch (error) {
            console.error('Error starting download:', error);
            showError('Failed to start download. Please try again.');
        } finally {
            downloadBtn.disabled = false;
            videoUrlInput.value = '';
        }
    });

    function formatBytes(bytes, decimals = 2) {
        if (!bytes) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    function createDownloadProgressElement(videoId, initialData = null) {
        const progressDiv = document.createElement('div');
        progressDiv.id = `download-${videoId}`;
        progressDiv.className = 'download-item mb-3 p-3 border rounded';
        
        const title = initialData?.title || 'Loading...';
        const progress = initialData?.progress || 0;
        const status = initialData?.status || 'starting';
        
        progressDiv.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-2">
                <h5 class="video-title mb-0">${title}</h5>
                <span class="badge bg-primary">${status}</span>
            </div>
            <div class="progress mb-2">
                <div class="progress-bar" role="progressbar" style="width: ${progress}%" 
                     aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
                    ${progress.toFixed(1)}%
                </div>
            </div>
            <div class="download-details">
                <small class="text-muted">Speed: <span class="speed">Calculating...</span></small>
                <small class="text-muted ms-3">ETA: <span class="eta">Calculating...</span></small>
                <small class="text-muted ms-3">Size: <span class="size">Calculating...</span></small>
            </div>
        `;
        
        return progressDiv;
    }

    function updateDownloadProgress(videoId, progressData) {
        const downloadElement = document.getElementById(`download-${videoId}`);
        if (!downloadElement) {
            const newElement = createDownloadProgressElement(videoId, progressData);
            activeDownloadsContainer.insertBefore(newElement, activeDownloadsContainer.firstChild);
            return;
        }
        
        const progressBar = downloadElement.querySelector('.progress-bar');
        const speedElement = downloadElement.querySelector('.speed');
        const etaElement = downloadElement.querySelector('.eta');
        const sizeElement = downloadElement.querySelector('.size');
        const titleElement = downloadElement.querySelector('.video-title');
        const statusBadge = downloadElement.querySelector('.badge');
        
        if (progressData.title && titleElement) {
            titleElement.textContent = progressData.title;
        }
        
        if (progressData.status) {
            statusBadge.textContent = progressData.status;
        }
        
        if (progressBar) {
            const progress = progressData.progress || 0;
            progressBar.style.width = `${progress}%`;
            progressBar.setAttribute('aria-valuenow', progress);
            progressBar.textContent = `${progress.toFixed(1)}%`;
        }
        
        if (speedElement && progressData.speed) {
            speedElement.textContent = formatSpeed(progressData.speed);
        }
        
        if (etaElement && progressData.eta) {
            etaElement.textContent = formatTime(progressData.eta);
        }
        
        if (sizeElement && progressData.total_bytes) {
            const downloaded = formatBytes(progressData.downloaded_bytes);
            const total = formatBytes(progressData.total_bytes);
            sizeElement.textContent = `${downloaded} / ${total}`;
        }
    }

    function fetchDownloadHistory() {
        fetch('/api/downloads')
            .then(response => response.json())
            .then(data => {
                updateDownloadHistory(data.history);
            })
            .catch(error => console.error('Error fetching download history:', error));
    }

    function updateDownloadHistory(history) {
        downloadHistoryContainer.innerHTML = '';
        historyCountBadge.textContent = history.length;
        
        if (history.length === 0) {
            downloadHistoryContainer.innerHTML = '<div class="col-12"><p class="text-muted text-center">No downloads yet</p></div>';
            return;
        }
        
        history.reverse().forEach(video => {
            const col = document.createElement('div');
            col.className = 'col-md-4 mb-3';
            
            const downloadTime = new Date(video.download_time);
            const formattedDate = downloadTime.toLocaleDateString() + ' ' + downloadTime.toLocaleTimeString();
            
            col.innerHTML = `
                <div class="card h-100">
                    <div class="card-body">
                        <h5 class="card-title text-truncate" title="${video.title}">${video.title}</h5>
                        <p class="card-text">
                            <small class="text-muted">Downloaded: ${formattedDate}</small><br>
                            <small class="text-muted">Resolution: ${video.resolution}</small>
                        </p>
                        <div class="d-grid gap-2">
                            <button class="btn btn-primary btn-sm" onclick="window.open('${video.filename}', '_blank')">
                                Open Video
                            </button>
                            <button class="btn btn-outline-secondary btn-sm" onclick="window.open('${video.url}', '_blank')">
                                View Source
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            downloadHistoryContainer.appendChild(col);
        });
    }

    function formatSpeed(bytesPerSecond) {
        if (!bytesPerSecond) return '0 KB/s';
        const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        let speed = bytesPerSecond;
        let unitIndex = 0;
        while (speed >= 1024 && unitIndex < units.length - 1) {
            speed /= 1024;
            unitIndex++;
        }
        return `${speed.toFixed(1)} ${units[unitIndex]}`;
    }

    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    function formatTime(seconds) {
        if (!seconds) return '';
        const minutes = Math.floor(seconds / 60);
        seconds = Math.floor(seconds % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
});
