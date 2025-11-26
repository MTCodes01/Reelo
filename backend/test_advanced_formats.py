import asyncio
from app.converter import converter
from app.models import FormatType

# Test URL (Rick Roll - reliable for testing)
url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

def test_format_options(format_type):
    print(f"\nTesting {format_type.value}...")
    try:
        opts = converter._get_format_options(format_type, url)
        print(f"Format string: {opts.get('format')}")
        
        if 'postprocessors' in opts:
            pp = opts['postprocessors'][0]
            print(f"Audio Quality: {pp.get('preferredquality')}k")
            
    except Exception as e:
        print(f"Error: {e}")

print("--- Testing Video Formats ---")
test_format_options(FormatType.MP4_1440)
test_format_options(FormatType.MP4_2160)

print("\n--- Testing Audio Formats ---")
test_format_options(FormatType.MP3_48)
test_format_options(FormatType.MP3_128)
test_format_options(FormatType.MP3_240)
test_format_options(FormatType.MP3_320)
