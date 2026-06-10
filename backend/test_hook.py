import yt_dlp

def progress_hook(d):
    print(f"HOOK: {d['status']} | {d.get('_percent_str', 'no percent')}")

opts = {'quiet': True, 'nocolor': True, 'progress_hooks': [progress_hook]}
yt_dlp.YoutubeDL(opts).download(['https://www.youtube.com/watch?v=M4uhxK1yr9o'])
