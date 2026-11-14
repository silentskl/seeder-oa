#!/usr/bin/env python3
"""Export every Cloudflare R2 object to Seeder's node-mode uploads layout.

Requires boto3: python3 -m pip install -r deploy/ubuntu/requirements.txt
Credentials are read from environment, never passed on the command line.
This writes <key> and <key>.meta.json, compatible with Seeder's local.ts.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

def key_file(root: Path, key: str) -> Path:
    if not key or key.startswith("/") or "\\" in key or "\x00" in key:
        raise ValueError(f"Unsafe R2 object key: {key!r}")
    if key.endswith(".meta.json") or any(p in ("", ".", "..") for p in key.split("/")):
        raise ValueError(f"Unsupported R2 object key (local metadata collision/traversal): {key!r}")
    output = (root / key).resolve()
    output.relative_to(root.resolve())  # fail closed on path traversal
    return output

def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".json-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1048576), b""):
            digest.update(chunk)
    return digest.hexdigest()

def export(bucket: str, dest: Path, manifest: Path) -> None:
    try:
        import boto3
    except ImportError as exc:
        raise SystemExit("boto3 is required: python3 -m pip install -r deploy/ubuntu/requirements.txt") from exc
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    if not all((account,key,secret)):
        raise SystemExit("CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set")
    dest.mkdir(parents=True, exist_ok=True)
    client = boto3.client("s3",region_name="auto",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=key, aws_secret_access_key=secret)
    results = []
    seen = set()
    total_bytes = 0
    pages = client.get_paginator("list_objects_v2").paginate(Bucket=bucket)
    for page in pages:
        for entry in page.get("Contents", []):
            name = entry["Key"]
            if name in seen:
                raise RuntimeError("R2 listing repeated object key: "+name)
            seen.add(name)
            file = key_file(dest, name)
            size = int(entry["Size"])
            source_etag = str(entry.get("ETag") or "").strip('"')
            sidecar = Path(str(file) + ".meta.json")
            valid = False
            if file.is_file() and sidecar.is_file():
                try:
                    old = json.loads(sidecar.read_text(encoding="utf-8"))
                    valid = (file.stat().st_size == size and old.get("sourceETag") == source_etag
                        and old.get("sha256") == sha256_file(file))
                except (ValueError, OSError):
                    valid = False
            if valid:
                digest = old["sha256"]
                content_type = old.get("contentType")
                cache_control = old.get("cacheControl")
                print("UNCHANGED",name)
            else:
                file.parent.mkdir(parents=True, exist_ok=True)
                fd, part = tempfile.mkstemp(prefix=".r2-",dir=str(file.parent))
                try:
                    with os.fdopen(fd,"wb") as output:
                        item = client.get_object(Bucket=bucket,Key=name)
                        downloaded = 0
                        digestor = hashlib.sha256()
                        for chunk in item["Body"].iter_chunks(chunk_size=1048576):
                            if not chunk:
                                continue
                            output.write(chunk)
                            digestor.update(chunk)
                            downloaded += len(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    if downloaded != size:
                        raise RuntimeError(f"R2 object size changed during export: {name!r}; retry after writes are frozen")
                    digest = digestor.hexdigest()
                    content_type = item.get("ContentType")
                    cache_control = item.get("CacheControl")
                    metadata = {
                        "contentType": content_type, "cacheControl": cache_control,
                        "etag": '"' + digest + '"', "sourceETag": source_etag,
                        "sha256": digest, "size": downloaded
                    }
                    # Store metadata first, then atomically publish the body.
                    save_json(sidecar,metadata)
                    os.replace(part,file)
                    print("COPIED",name)
                finally:
                    if os.path.exists(part):
                        os.unlink(part)
            results.append({"key":name,"size":size,"sha256":digest,"contentType":content_type})
            total_bytes += size
    # Do not silently accept orphaned objects in a resumed output directory:
    # destination must contain exactly this bucket's current manifest objects.
    present = {str(p.relative_to(dest)) for p in dest.rglob("*")
        if p.is_file() and not p.name.endswith(".meta.json") and not p.name.startswith(".r2-")}
    if present != seen:
        missing = sorted(present - seen)
        raise RuntimeError("Destination contains objects absent from current R2 listing: "+
            repr(missing[:5]) + "; export to an empty directory for a final cutover")
    results.sort(key=lambda item:item["key"])
    save_json(manifest,{"format":"seeder-oa-r2-v1","bucket":bucket,
        "objectCount":len(results),"totalBytes":total_bytes,"objects":results})
    print(f"R2 export completed: {len(results)} objects, {total_bytes} bytes; manifest: {manifest}")

def main():
    parser=argparse.ArgumentParser(description="Export R2 bucket objects into local storage layout")
    parser.add_argument("--bucket",required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--manifest",type=Path,required=True)
    args=parser.parse_args()
    export(args.bucket,args.output.resolve(),args.manifest.resolve())

if __name__=="__main__":
    main()
