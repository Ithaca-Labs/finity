"use client";

import { useState } from "react";

const videoSrc = "/demo/finity-demo.mp4";

export function DemoVideo() {
  const [videoState, setVideoState] = useState<"loading" | "ready" | "missing">("loading");

  return (
    <section className="demo-video" aria-label="Finity demo video">
      <div className={`video-frame video-${videoState}`}>
        <video
          className="demo-video-player"
          controls
          playsInline
          preload="metadata"
          onCanPlay={() => setVideoState("ready")}
          onError={() => setVideoState("missing")}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>

        {videoState !== "ready" && (
          <div className="video-empty">
            <span className="status-dot" aria-hidden="true" />
            <strong>the proof lives here.</strong>
            <p>Drop the finished walkthrough into</p>
            <code>public/demo/finity-demo.mp4</code>
          </div>
        )}
      </div>
    </section>
  );
}
