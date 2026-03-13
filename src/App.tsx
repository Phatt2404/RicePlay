import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Upload, Sparkles, RefreshCcw, CheckCircle2, AlertCircle, Loader2, Maximize } from 'lucide-react';
import confetti from 'canvas-confetti';
import { GoogleGenAI, Modality } from "@google/genai";

type AppState = 'home' | 'camera' | 'loading' | 'result' | 'error';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  const [state, setState] = useState<AppState>('home');
  const [image, setImage] = useState<string | null>(null);
  const [detectedObject, setDetectedObject] = useState<string>('');
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [warning, setWarning] = useState<string>('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [magicMode, setMagicMode] = useState(true);
  const [engine, setEngine] = useState<'runway' | 'veo'>('runway');
  const [volume, setVolume] = useState(1);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      }
    };
    checkApiKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const startCamera = async () => {
    try {
      setState('camera');
      setIsCapturing(true);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' }, 
        audio: false 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Could not access camera. Please check permissions.");
      setState('error');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCapturing(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg');
        setImage(base64);
        stopCamera();
        processImage(base64);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setImage(base64);
        processImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const generateAudio = async (objectName: string) => {
    setIsGeneratingAudio(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Make a very short, cute, and playful sound effect or a tiny greeting for a clay ${objectName} that just came to life. It should sound like a stop-motion character. Examples: "Boing!", "Hello!", "Tada!", or a cute squeak. Keep it under 2 seconds.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioBlob = await (await fetch(`data:audio/mp3;base64,${base64Audio}`)).blob();
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        
        // Auto-play the sound
        const audio = new Audio(url);
        audio.volume = volume;
        audio.play().catch(e => console.warn("Audio auto-play blocked:", e));
      }
    } catch (err) {
      console.error("Failed to generate audio:", err);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const processImage = async (base64Image: string) => {
    setState('loading');
    setWarning('');
    try {
      if (engine === 'veo') {
        await generateWithVeo(base64Image);
        return;
      }

      // Send to backend for Runway animation
      const response = await fetch('/api/clay/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          image: base64Image,
          useDemo: !magicMode
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate animation");
      }

      const data = await response.json();
      setDetectedObject(data.object);
      setVideoUrl(data.videoUrl);
      
      if (data.warning) {
        setWarning(data.warning);
      } else if (data.isDemo) {
        setWarning("Note: Using demo video mode.");
      }

      setState('result');
      
      // Generate cute sound effect
      generateAudio(data.object || "clay creation");
      
      // Trigger confetti
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#FF6B6B', '#4ECDC4', '#FFE66D', '#FF9F1C']
      });
    } catch (err: any) {
      console.error("Process error:", err);
      setError(err.message || "Something went wrong. Please try again.");
      setState('error');
    }
  };

  const generateWithVeo = async (base64Image: string) => {
    try {
      // Check for API key selection
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        if (!selected) {
          setHasApiKey(false);
          throw new Error("Please select a paid Gemini API key to use Veo.");
        }
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });
      
      // Extract base64 data and mime type
      const mimeType = base64Image.split(';')[0].split(':')[1];
      const base64Data = base64Image.split(',')[1];

      const animationPrompt = "A playful stop-motion clay animation. The clay character in the image comes to life and performs natural movements. Movement should be lively and exaggerated like a children's cartoon. Keep the handmade clay texture visible. Bright colorful lighting, cute miniature world style.";

      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: animationPrompt,
        image: {
          imageBytes: base64Data,
          mimeType: mimeType,
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      // Poll for completion
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!downloadLink) throw new Error("Failed to get video download link from Veo");

      // Fetch the video using the API key
      const videoResponse = await fetch(downloadLink, {
        method: 'GET',
        headers: {
          'x-goog-api-key': process.env.GEMINI_API_KEY || '',
        },
      });

      if (!videoResponse.ok) throw new Error("Failed to download video from Veo");
      
      const blob = await videoResponse.blob();
      const url = URL.createObjectURL(blob);
      
      setDetectedObject("clay creation");
      setVideoUrl(url);
      setState('result');

      // Generate cute sound effect
      generateAudio("clay creation");
      
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#FF6B6B', '#4ECDC4', '#FFE66D', '#FF9F1C']
      });
    } catch (err: any) {
      console.error("Veo error:", err);
      
      // Handle specific 403/Permission Denied errors by prompting for key selection
      if (err.message?.includes("permission") || err.message?.includes("403") || err.message?.includes("not found")) {
        setHasApiKey(false);
        setError("Veo requires a paid Gemini API key. Please select one to continue.");
      } else {
        setError(err.message || "Veo generation failed. Please try again.");
      }
      setState('error');
    }
  };

  const resetApp = () => {
    stopCamera();
    setState('home');
    setImage(null);
    setDetectedObject('');
    setVideoUrl('');
    setAudioUrl('');
    setError('');
    setWarning('');
  };

  const toggleFullscreen = () => {
    if (resultVideoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        resultVideoRef.current.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable full-screen mode: ${err.message}`);
        });
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#FFF9F0] font-sans text-[#4A4A4A] overflow-hidden">
      <AnimatePresence mode="wait">
        {state === 'home' && (
          <motion.div 
            key="home"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center justify-center min-h-screen p-6 text-center"
          >
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ repeat: Infinity, duration: 4 }}
              className="w-32 h-32 mb-8 bg-[#FF9F1C] rounded-3xl flex items-center justify-center shadow-lg"
            >
              <Sparkles className="w-16 h-16 text-white" />
            </motion.div>
            
            <h1 className="text-5xl font-black text-[#FF6B6B] mb-4 tracking-tight">
              Clay to Life AI
            </h1>
            <p className="text-xl text-[#6B705C] mb-12 max-w-xs leading-relaxed">
              Take a photo of your clay creation and watch it come to life!
            </p>

            <div className="flex flex-col gap-4 w-full max-w-xs">
              <div className="flex flex-col gap-2 bg-white/50 backdrop-blur-sm p-4 rounded-2xl mb-2 border border-white/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className={`w-5 h-5 ${magicMode ? 'text-[#FF9F1C]' : 'text-gray-400'}`} />
                    <span className="font-bold text-sm">AI Magic Mode</span>
                  </div>
                  <button 
                    onClick={() => setMagicMode(!magicMode)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${magicMode ? 'bg-[#4ECDC4]' : 'bg-gray-300'}`}
                  >
                    <motion.div 
                      animate={{ x: magicMode ? 24 : 4 }}
                      className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                    />
                  </button>
                </div>

                <div className="h-px bg-white/30 my-1" />

                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-500 uppercase">Engine</span>
                  <div className="flex bg-gray-200 rounded-lg p-1">
                    <button 
                      onClick={() => setEngine('runway')}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${engine === 'runway' ? 'bg-white shadow-sm text-[#FF6B6B]' : 'text-gray-500'}`}
                    >
                      Runway
                    </button>
                    <button 
                      onClick={() => setEngine('veo')}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${engine === 'veo' ? 'bg-white shadow-sm text-[#4ECDC4]' : 'text-gray-500'}`}
                    >
                      Veo
                    </button>
                  </div>
                </div>

                {!hasApiKey && engine === 'veo' && (
                  <div className="mt-2 p-3 bg-red-50 border border-red-100 rounded-xl">
                    <p className="text-[10px] text-red-600 font-medium mb-2">
                      Veo requires a paid API key. <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline">Learn more</a>
                    </p>
                    <button 
                      onClick={handleSelectKey}
                      className="w-full py-2 bg-red-500 text-white text-xs font-bold rounded-lg hover:bg-red-600 transition-colors"
                    >
                      Select API Key
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={startCamera}
                className="flex items-center justify-center gap-3 bg-[#4ECDC4] hover:bg-[#45B7AF] text-white font-bold py-5 px-8 rounded-2xl shadow-md transition-all active:scale-95 text-lg"
              >
                <Camera className="w-6 h-6" />
                Take Photo
              </button>
              
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-3 bg-white border-4 border-[#FFE66D] hover:bg-[#FFFDF0] text-[#FF9F1C] font-bold py-5 px-8 rounded-2xl shadow-sm transition-all active:scale-95 text-lg"
              >
                <Upload className="w-6 h-6" />
                Upload from Gallery
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*" 
                onChange={handleFileUpload}
              />
            </div>
          </motion.div>
        )}

        {state === 'camera' && (
          <motion.div 
            key="camera"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-50 flex flex-col"
          >
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="flex-1 object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />
            
            <div className="absolute bottom-12 left-0 right-0 flex justify-center items-center gap-12 px-8">
              <button 
                onClick={resetApp}
                className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white"
              >
                <RefreshCcw className="w-6 h-6" />
              </button>
              
              <button 
                onClick={capturePhoto}
                className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-xl active:scale-90 transition-transform"
              >
                <div className="w-16 h-16 border-4 border-black/10 rounded-full" />
              </button>
              
              <div className="w-14 h-14" /> {/* Spacer */}
            </div>
          </motion.div>
        )}

        {state === 'loading' && (
          <motion.div 
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center min-h-screen p-6 text-center bg-[#FFF9F0]"
          >
            <div className="relative w-48 h-48 mb-8">
              <motion.div
                animate={{ 
                  scale: [1, 1.1, 1],
                  rotate: 360 
                }}
                transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                className="absolute inset-0 bg-[#FFE66D] rounded-full opacity-20"
              />
              <motion.div
                animate={{ 
                  y: [0, -20, 0],
                  rotate: [0, 10, -10, 0]
                }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <div className="w-24 h-24 bg-[#FF9F1C] rounded-2xl shadow-lg flex items-center justify-center">
                  <Sparkles className="w-12 h-12 text-white" />
                </div>
              </motion.div>
            </div>
            
            <h2 className="text-3xl font-bold text-[#FF6B6B] mb-4">
              AI is bringing your clay creation to life...
            </h2>
            <p className="text-[#6B705C] animate-pulse">
              Magic takes a moment! ✨
            </p>
          </motion.div>
        )}

        {state === 'result' && (
          <motion.div 
            key="result"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center min-h-screen p-6 bg-[#FFF9F0]"
          >
            <div className="bg-white p-4 rounded-[2.5rem] shadow-2xl w-full max-w-md mb-8 border-8 border-[#FFE66D]">
              <div className="aspect-square rounded-[1.5rem] overflow-hidden bg-gray-100 relative group">
                <video 
                  ref={resultVideoRef}
                  src={videoUrl} 
                  autoPlay 
                  loop 
                  playsInline
                  controls
                  className="w-full h-full object-cover"
                  onVolumeChange={(e) => setVolume((e.target as HTMLVideoElement).volume)}
                />
                <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#4ECDC4]" />
                  <span className="font-bold text-sm uppercase tracking-wider">
                    AI Detected: {detectedObject}
                  </span>
                </div>
                
                {/* Custom Volume Slider Overlay */}
                <div className="absolute bottom-4 left-4 right-16 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-white text-[10px] font-bold uppercase">Vol</span>
                  <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.01" 
                    value={volume}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setVolume(val);
                      if (resultVideoRef.current) resultVideoRef.current.volume = val;
                    }}
                    className="flex-1 h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-[#4ECDC4]"
                  />
                </div>

                <button 
                  onClick={toggleFullscreen}
                  className="absolute bottom-4 right-4 bg-black/50 hover:bg-black/70 text-white p-3 rounded-full backdrop-blur-sm transition-all opacity-0 group-hover:opacity-100"
                  title="Toggle Fullscreen"
                >
                  <Maximize className="w-5 h-5" />
                </button>

                {isGeneratingAudio && (
                  <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm flex items-center gap-2 animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin text-[#FF6B6B]" />
                    <span className="text-[10px] font-bold uppercase">Generating Voice...</span>
                  </div>
                )}
              </div>
            </div>

            <div className="text-center mb-8">
              <h2 className="text-3xl font-black text-[#FF6B6B] mb-2">
                Look! Your clay {detectedObject} is moving!
              </h2>
              <p className="text-lg text-[#6B705C]">
                It's alive! How magical! ✨
              </p>
            </div>

            {warning && (
              <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm max-w-xs text-center">
                {warning}
              </div>
            )}

            <button
              onClick={resetApp}
              className="flex items-center justify-center gap-3 bg-[#4ECDC4] hover:bg-[#45B7AF] text-white font-bold py-4 px-10 rounded-2xl shadow-md transition-all active:scale-95"
            >
              <RefreshCcw className="w-5 h-5" />
              Create Another
            </button>
          </motion.div>
        )}

        {state === 'error' && (
          <motion.div 
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center min-h-screen p-6 text-center bg-[#FFF9F0]"
          >
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Oops! Something went wrong</h2>
            <p className="text-gray-600 mb-8 max-w-xs">{error}</p>
            
            <div className="flex flex-col gap-3 w-full max-w-xs">
              {error.includes("API key") && (
                <button
                  onClick={handleSelectKey}
                  className="bg-[#4ECDC4] text-white font-bold py-4 px-10 rounded-2xl shadow-md transition-all active:scale-95"
                >
                  Select API Key
                </button>
              )}
              <button
                onClick={resetApp}
                className="bg-gray-800 text-white font-bold py-4 px-10 rounded-2xl shadow-md transition-all active:scale-95"
              >
                Try Again
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
