from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import yt_dlp
import os
import threading
import json
from datetime import datetime
from queue import Queue
import concurrent.futures

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key'
socketio = SocketIO(app)

# Create downloads directory if it doesn't exist
DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'downloads')
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# Store active downloads and their progress
active_downloads = {}
download_queue = Queue()
download_history = []

def download_progress_hook(d):
    if d['status'] == 'downloading':
        try:
            video_id = d['info_dict']['id']
            video_title = d['info_dict'].get('title', 'Unknown Title')
            
            # Get download progress information
            total_bytes = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
            downloaded_bytes = d.get('downloaded_bytes', 0)
            
            # Calculate progress percentage
            progress = (downloaded_bytes / total_bytes * 100) if total_bytes > 0 else 0
            
            # Create progress data with all necessary information
            progress_data = {
                'downloaded_bytes': downloaded_bytes,
                'total_bytes': total_bytes,
                'speed': d.get('speed', 0),
                'eta': d.get('eta', 0),
                'progress': progress,
                'title': video_title,
                'filename': d.get('filename', ''),
                'tmpfilename': d.get('tmpfilename', ''),
                '_percent_str': d.get('_percent_str', ''),
                '_speed_str': d.get('_speed_str', ''),
                '_eta_str': d.get('_eta_str', '')
            }
            
            active_downloads[video_id] = progress_data
            socketio.emit('download_progress', {'video_id': video_id, 'progress': progress_data})
            
        except Exception as e:
            app.logger.error(f"Error in progress hook: {str(e)}")
            socketio.emit('download_error', {'video_id': video_id, 'error': str(e)})

def get_format_for_resolution(resolution):
    resolution_map = {
        '8K': '4320',
        '4K': '2160',
        '1440p': '1440',
        '1080p': '1080',
        '720p': '720',
        '480p': '480',
        '360p': '360',
        '240p': '240',
    }
    
    try:
        if resolution not in resolution_map:
            return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
            
        target_height = resolution_map[resolution]
        format_str = f'bestvideo[height<={target_height}][ext=mp4]+bestaudio[ext=m4a]/best[height<={target_height}][ext=mp4]/best[height<={target_height}]'
        print(f"Selected format string: {format_str}")
        return format_str
    except Exception as e:
        print(f"Error getting format string: {str(e)}")
        return 'best[ext=mp4]/best'

def get_actual_resolution(formats):
    try:
        if not formats:
            return 'Unknown'
            
        # Get the height of the best video format
        max_height = 0
        for f in formats:
            if isinstance(f, dict):  # Ensure f is a dictionary
                height = f.get('height')
                if isinstance(height, (int, float)) and height > max_height:  # Ensure height is a number
                    max_height = height
        
        # If no valid height found
        if max_height == 0:
            return 'Unknown'
        
        # Map height to common resolution names
        if max_height >= 4320:
            return '8K'
        elif max_height >= 2160:
            return '4K'
        elif max_height >= 1440:
            return '2K'
        elif max_height >= 1080:
            return 'FHD'
        elif max_height >= 720:
            return 'HD'
        elif max_height >= 480:
            return '480p'
        elif max_height >= 360:
            return '360p'
        elif max_height >= 240:
            return '240p'
        elif max_height >= 144:
            return '144p'
        else:
            return f'{max_height}p'
    except Exception as e:
        print(f"Error detecting resolution: {str(e)}")
        return 'Unknown'

def download_video(url, resolution='1080p'):
    print(f"Starting download for URL: {url} at resolution: {resolution}")
    video_id = None
    
    try:
        ydl_opts = {
            'format': get_format_for_resolution(resolution),
            'outtmpl': os.path.join(DOWNLOAD_DIR, '%(title)s.%(ext)s'),
            'progress_hooks': [download_progress_hook],
            'writethumbnail': True,
            'quiet': False,
            'noplaylist': True,
            'merge_output_format': 'mp4',
            'postprocessors': [
                {
                    'key': 'FFmpegVideoConvertor',
                    'preferedformat': 'mp4',
                },
                {
                    'key': 'FFmpegMetadata',
                    'add_metadata': True,
                }
            ],
            'nocheckcertificate': True,
            'extractor_retries': 3
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            print("Extracting video info...")
            info = ydl.extract_info(url, download=False)
            if not info:
                raise Exception("Failed to extract video information")
                
            video_id = info.get('id')
            if not video_id:
                raise Exception("Failed to get video ID")
            
            # Get available formats and determine actual resolution
            formats = info.get('formats', [])
            actual_resolution = get_actual_resolution(formats)
            print(f"Detected resolution: {actual_resolution}")
            
            # Start actual download
            print("Starting actual download...")
            download_info = ydl.extract_info(url, download=True)
            if not download_info:
                raise Exception("Download failed")
                
            print(f"Download completed for video: {download_info.get('title', 'Unknown')}")
            
            # Get the actual output filename
            filename = os.path.join(DOWNLOAD_DIR, ydl.prepare_filename(download_info))
            # Ensure the extension is .mp4
            if not filename.endswith('.mp4'):
                base_filename = os.path.splitext(filename)[0]
                filename = base_filename + '.mp4'
            
            video_info = {
                'id': video_id,
                'title': download_info.get('title', 'Unknown'),
                'thumbnail': download_info.get('thumbnail'),
                'duration': download_info.get('duration'),
                'download_time': datetime.now().isoformat(),
                'filename': filename,
                'resolution': actual_resolution,
                'url': url
            }
            
            # Add to download history
            download_history.append(video_info)
            
            # Emit download complete event with video info
            socketio.emit('download_complete', video_info)
            return video_info
            
    except Exception as e:
        error_msg = f"Error downloading video: {str(e)}"
        print(error_msg)
        if video_id:
            socketio.emit('download_error', {'video_id': video_id, 'error': error_msg})
        raise
    finally:
        # Clean up active downloads entry
        if video_id and video_id in active_downloads:
            del active_downloads[video_id]

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/download', methods=['POST'])
def start_download():
    try:
        url = request.json.get('url')
        resolution = request.json.get('resolution', '1080p')
        
        if not url:
            return jsonify({'error': 'URL is required'}), 400

        # Extract video info first to get the title
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': True
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(url, download=False)
                video_id = info.get('id')
                video_title = info.get('title', 'Unknown Title')
                
                # Add to active downloads immediately with initial state
                active_downloads[video_id] = {
                    'progress': 0,
                    'title': video_title,
                    'status': 'starting',
                    'url': url,
                    'resolution': resolution
                }
                
                # Emit the initial state
                socketio.emit('download_progress', {
                    'video_id': video_id,
                    'progress': active_downloads[video_id]
                })
                
                # Start download in background
                thread = threading.Thread(target=download_video, args=(url, resolution))
                thread.daemon = True
                thread.start()
                
                return jsonify({
                    'status': 'success',
                    'video_id': video_id,
                    'title': video_title
                })
                
            except Exception as e:
                app.logger.error(f"Error extracting video info: {str(e)}")
                return jsonify({'error': str(e)}), 400
                
    except Exception as e:
        app.logger.error(f"Error in start_download: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/downloads', methods=['GET'])
def get_downloads():
    # Return both active downloads and download history
    return jsonify({
        'active': active_downloads,
        'history': download_history
    })

@app.route('/api/test', methods=['GET'])
def test_endpoint():
    app.logger.debug("Test endpoint called")
    return jsonify({'status': 'ok', 'message': 'Server is running'})

if __name__ == '__main__':
    import logging
    logging.basicConfig(level=logging.DEBUG)
    app.logger.setLevel(logging.DEBUG)
    print("Starting Flask server in debug mode...")
    socketio.run(app, debug=True, use_reloader=False, allow_unsafe_werkzeug=True, port=5001)
