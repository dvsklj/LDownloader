# VidLoader - YouTube Video Downloader

A beautiful web-based YouTube video downloader with parallel download support and real-time progress tracking.

## Features

- Modern, responsive web interface
- Real-time download progress tracking
- Parallel video downloads
- Video thumbnail display
- Download history
- Speed and ETA information

## Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/VidLoader.git
cd VidLoader
```

2. Create a virtual environment and activate it:
```bash
python -m venv venv
source venv/bin/activate  # On Windows, use: venv\Scripts\activate
```

3. Install the required packages:
```bash
pip install -r requirements.txt
```

## Usage

1. Start the application:
```bash
python app.py
```

2. Open your web browser and navigate to `http://localhost:5001`

3. Paste a YouTube URL and click Download

## Requirements

- Python 3.7+
- Flask
- yt-dlp
- Flask-SocketIO

## License

MIT License
