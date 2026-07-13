import os
import re
import urllib.request

output_dir = "/Users/sudhanshu/.gemini/antigravity/scratch/appleverse"
public_images_dir = os.path.join(output_dir, "public", "images")
os.makedirs(public_images_dir, exist_ok=True)

# Product description keyword to Unsplash URL mapping (Verified working IDs)
images_map = {
    "macbook pro": "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=1200&q=80",
    "macbook air": "https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?auto=format&fit=crop&w=1200&q=80",
    "iphone 15 pro": "https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=800&q=80",
    "iphone 17 pro": "https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=800&q=80",
    "iphone 17": "https://images.unsplash.com/photo-1523206489230-c012c64b2b48?auto=format&fit=crop&w=800&q=80",
    "iphone 16": "https://images.unsplash.com/photo-1573148195900-7845dcb9b127?auto=format&fit=crop&w=800&q=80",
    "iphone se": "https://images.unsplash.com/photo-1565630916779-e303be97b6f5?auto=format&fit=crop&w=800&q=80",
    "iphone camera": "https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?auto=format&fit=crop&w=800&q=80",
    "magsafe wallet": "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=80",
    "iphone cases": "https://images.unsplash.com/photo-1603302576837-37561b2e2302?auto=format&fit=crop&w=800&q=80",
    "magsafe": "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=80",
    "cases": "https://images.unsplash.com/photo-1603302576837-37561b2e2302?auto=format&fit=crop&w=800&q=80",
    "case": "https://images.unsplash.com/photo-1603302576837-37561b2e2302?auto=format&fit=crop&w=800&q=80",
    
    "watch ultra 2": "https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?auto=format&fit=crop&w=800&q=80",
    "watch ultra": "https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?auto=format&fit=crop&w=800&q=80",
    "watch series 10": "https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?auto=format&fit=crop&w=800&q=80",
    "watch se": "https://images.unsplash.com/photo-1542496658-e33a6d0d50f6?auto=format&fit=crop&w=800&q=80",
    "rose gold": "https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?auto=format&fit=crop&w=800&q=80",
    "natural titanium": "https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?auto=format&fit=crop&w=800&q=80",
    "sensor": "https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?auto=format&fit=crop&w=800&q=80",
    "chip": "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=800&q=80",
    "band": "https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?auto=format&fit=crop&w=800&q=80",
    
    "vision pro": "https://images.unsplash.com/photo-1593508512255-86ab42a8e620?auto=format&fit=crop&w=1200&q=80",
    "airpods pro": "https://images.unsplash.com/photo-1588449668365-d15e397f6787?auto=format&fit=crop&w=800&q=80",
    "airpods max": "https://images.unsplash.com/photo-1613040809024-b4ef7ba99bc3?auto=format&fit=crop&w=800&q=80",
    "airpods 4": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80",
    "airpods": "https://images.unsplash.com/photo-1588449668365-d15e397f6787?auto=format&fit=crop&w=800&q=80",
    
    "beats studio pro": "https://images.unsplash.com/photo-1484704849700-f032a568e944?auto=format&fit=crop&w=800&q=80",
    "beats fit pro": "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=800&q=80",
    "beats solo buds": "https://images.unsplash.com/photo-1608156639585-b3a032ef9689?auto=format&fit=crop&w=800&q=80",
    "beats": "https://images.unsplash.com/photo-1484704849700-f032a568e944?auto=format&fit=crop&w=800&q=80",
    
    "imac": "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=1200&q=80",
    "mac studio": "https://images.unsplash.com/photo-1547082299-de196ea013d6?auto=format&fit=crop&w=800&q=80",
    "mac mini": "https://images.unsplash.com/photo-1547082299-de196ea013d6?auto=format&fit=crop&w=800&q=80",
    "mac pro": "https://images.unsplash.com/photo-1547082299-de196ea013d6?auto=format&fit=crop&w=800&q=80",
    "macbook": "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=1200&q=80",
}

fallback_url = "https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=800&q=80"

sorted_keys = sorted(images_map.keys(), key=len, reverse=True)

files = ["index.html", "mac.html", "iphone.html", "watch.html", "audio-vision.html"]

downloaded_files = {}

# Set User-Agent to prevent HTTP 403 Forbidden from Unsplash
opener = urllib.request.build_opener()
opener.addheaders = [('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')]
urllib.request.install_opener(opener)

def get_product_key(desc):
    desc = desc.lower()
    for key in sorted_keys:
        if key in desc:
            return key
    return None

for filename in files:
    filepath = os.path.join(output_dir, filename)
    if not os.path.exists(filepath):
        continue
    
    print(f"\nProcessing {filename}...")
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # We find all img tags and look inside
    img_tags = re.findall(r'<img[^>]+>', content)
    
    updated_content = content
    for tag in img_tags:
        src_match = re.search(r'src=["\']([^"\']+)["\']', tag)
        if not src_match:
            continue
        src = src_match.group(1)
        
        # We only replace external googleusercontent URLs OR previously broken local ones
        if "lh3.googleusercontent.com" not in src and not src.startswith("/images/"):
            continue
            
        alt_match = re.search(r'alt=["\']([^"\']+)["\']', tag)
        alt = alt_match.group(1) if alt_match else ""
        
        data_alt_match = re.search(r'data-alt=["\']([^"\']+)["\']', tag)
        data_alt = data_alt_match.group(1) if data_alt_match else ""
        
        desc = alt or data_alt
        
        product_key = get_product_key(desc)
        if not product_key:
            # Try parsing the parent or fallback to a generic key
            product_key = "macbook" if "mac.html" in filename else "iphone"
            if "watch.html" in filename:
                product_key = "watch ultra"
            elif "audio-vision.html" in filename:
                product_key = "vision pro"
        
        local_filename = f"{product_key.replace(' ', '_')}.jpg"
        local_path = os.path.join(public_images_dir, local_filename)
        
        if local_filename not in downloaded_files:
            download_url = images_map.get(product_key, fallback_url)
            print(f"Downloading {download_url} to {local_path}...")
            try:
                urllib.request.urlretrieve(download_url, local_path)
                downloaded_files[local_filename] = True
            except Exception as e:
                print(f"Error downloading {download_url}: {e}")
                continue
                
        local_src = f"/images/{local_filename}"
        
        # Replace the src attribute in this tag
        new_tag = re.sub(r'src=["\']([^"\']+)["\']', f'src="{local_src}"', tag)
        updated_content = updated_content.replace(tag, new_tag)
        
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(updated_content)

print("\nDone downloading and updating pages!")
