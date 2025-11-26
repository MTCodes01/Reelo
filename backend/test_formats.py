import yt_dlp
import json

def test_format(url, format_str):
    opts = {
        'quiet': True,
        'format': format_str,
        'simulate': True,
        'forceurl': True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        print(f"Format: {format_str}")
        print(f"Selected: {info.get('format_note')} - {info.get('resolution')} - {info.get('ext')}")
        if 'requested_formats' in info:
            for f in info['requested_formats']:
                print(f"  - Component: {f.get('format_note')} ({f.get('resolution')})")

url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

print("--- Debugging 360p ---")
print("1. bestvideo[height<=360]+bestaudio")
test_format(url, 'bestvideo[height<=360]+bestaudio')

print("\n2. best[height<=360]")
test_format(url, 'best[height<=360]')

print("\n3. bestvideo[height=360]+bestaudio")
test_format(url, 'bestvideo[height=360]+bestaudio')

print("\n--- Debugging 720p ---")
print("1. bestvideo[height<=720]+bestaudio")
test_format(url, 'bestvideo[height<=720]+bestaudio')

print("\n2. best[height<=720]")
test_format(url, 'best[height<=720]')

print("\n3. bestvideo[height=720]+bestaudio")
test_format(url, 'bestvideo[height=720]+bestaudio')

print("\n--- Debugging 1080p ---")
print("1. bestvideo[height<=1080]+bestaudio")
test_format(url, 'bestvideo[height<=1080]+bestaudio')

print("\n2. best[height<=1080]")
test_format(url, 'best[height<=1080]')

print("\n3. bestvideo[height=1080]+bestaudio")
test_format(url, 'bestvideo[height=1080]+bestaudio')    