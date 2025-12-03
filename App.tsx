
import React, { useState, useEffect, useRef } from 'react';
import { 
  AppStep, AppState, LearningPillar, LessonPath, Curriculum, ChatMessage, User, SavedCourse
} from './types';
import { 
  generatePillars, generateLessonPaths, generateCurriculum, initializeChat, sendMessageToTutor, generateModuleAudio
} from './services/geminiService';
import {
  auth, db, signInWithGoogle, logoutUser
} from './services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, setDoc, getDocs, deleteDoc, query } from 'firebase/firestore';
import { 
  BookOpen, Compass, Layers, MessageCircle, Send, ChevronRight, ArrowLeft, CheckCircle, Target, Check, Save, ThumbsUp, ThumbsDown, Image, ExternalLink,
  Cpu, Beaker, Palette, Briefcase, Globe, HeartPulse, Hourglass, Calculator, Scale, Music, Lightbulb, Wrench, Brain, Leaf, Users, Database, Headphones, Play, Pause, Square, FastForward,
  User as UserIcon, LogOut, LayoutGrid, Plus, Trash, Google
} from './components/Icons';
import Loading from './components/Loading';
import ReactMarkdown from 'react-markdown';

const INITIAL_STATE: AppState = {
  step: AppStep.AUTH, // Start at Auth
  user: null,
  library: [],
  activeCourseId: null,
  
  subject: '',
  selectedPillar: null,
  selectedPath: null,
  curriculum: null,
  completedSubLessons: [],
  subLessonFeedback: {},
  pillars: [],
  paths: [],
  chatHistory: [],
  isLoading: false,
  error: null,
};

const STORAGE_KEY = 'cognipath_state_v5';

// Helper to convert raw PCM (Int16) to WAV Blob for use in <audio> element
function pcmToWav(pcmData: string, sampleRate: number = 24000, numChannels: number = 1): Blob {
  const binaryString = atob(pcmData);
  const len = binaryString.length;
  const buffer = new ArrayBuffer(44 + len);
  const view = new DataView(buffer);
  
  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // file length
  view.setUint32(4, 36 + len, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * blockAlign)
  view.setUint32(28, sampleRate * numChannels * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, numChannels * 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, len, true);

  // write the PCM samples
  const bytes = new Uint8Array(buffer, 44);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

interface LessonVisualProps {
  description: string;
}

const LessonVisual: React.FC<LessonVisualProps> = ({ description }) => {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!description) return;
    setLoading(true);
    setError(false);
    const encoded = encodeURIComponent(description);
    // Use pollinations.ai to generate image from description
    setImgSrc(`https://image.pollinations.ai/prompt/${encoded}?nologo=true&width=800&height=600&seed=${Math.floor(Math.random() * 1000)}`);
  }, [description]);

  if (error || !description) {
     return (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-4 flex flex-col items-center justify-center text-center h-48">
            <div className="bg-white p-2 rounded-full shadow-sm mb-2">
                <Image className="w-5 h-5 text-gray-400" />
            </div>
            <span className="text-xs font-bold uppercase text-gray-400 mb-1">Visual Concept</span>
            <p className="text-xs text-gray-500">{description || 'No visual description available.'}</p>
        </div>
     );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 shadow-sm relative h-64 bg-gray-100 group mb-6">
       <img 
         src={imgSrc || ''} 
         alt={description}
         className={`w-full h-full object-cover transition-opacity duration-700 ${loading ? 'opacity-0' : 'opacity-100'}`}
         onLoad={() => setLoading(false)}
         onError={() => setError(true)}
       />
       {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
             <div className="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin"></div>
          </div>
       )}
       {/* Hover overlay with description */}
       {!loading && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center p-4">
             <p className="text-white text-xs text-center font-medium">{description}</p>
          </div>
       )}
    </div>
  );
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(() => {
    // Lazy initialization for session state, but library now comes from Firebase
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return { ...INITIAL_STATE, ...parsed };
        } catch (e) {
          console.error("Failed to parse saved state", e);
        }
      }
    }
    return INITIAL_STATE;
  });

  const [inputText, setInputText] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  
  const [isSaved, setIsSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  
  // Audio state
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Monitor Firebase Auth State
  useEffect(() => {
    if (!auth) {
      // If Firebase Auth is not initialized (missing config), we stop loading
      // and wait for manual mock login
      setIsAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const user: User = {
          id: firebaseUser.uid,
          name: firebaseUser.displayName || 'Learner',
          email: firebaseUser.email || undefined,
          photoURL: firebaseUser.photoURL || undefined,
          joinedAt: Date.now()
        };
        
        setState(prev => ({ ...prev, user }));

        // Fetch User's Library from Firestore
        try {
          if (!db) return;
          const q = query(collection(db, `users/${user.id}/courses`));
          const querySnapshot = await getDocs(q);
          const library: SavedCourse[] = [];
          querySnapshot.forEach((doc) => {
            library.push(doc.data() as SavedCourse);
          });
          
          // Sort by last accessed
          library.sort((a, b) => b.lastAccessed - a.lastAccessed);
          
          setState(prev => ({ 
            ...prev, 
            library, 
            // If we were on AUTH step, go to DASHBOARD, otherwise stay (e.g. refresh on curriculum)
            step: prev.step === AppStep.AUTH ? AppStep.DASHBOARD : prev.step 
          }));
        } catch (error) {
          console.error("Error fetching courses:", error);
        }
      } else {
        setState(prev => ({ ...prev, user: null, step: AppStep.AUTH, library: [] }));
      }
      setIsAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Restore chat session on mount if we are in the curriculum view
  useEffect(() => {
    if (state.step === AppStep.CURRICULUM && state.curriculum && state.selectedPillar && state.selectedPath) {
       initializeChat(
         state.subject, 
         state.selectedPillar.title, 
         state.selectedPath.title, 
         state.curriculum,
         state.chatHistory
       );
    }
    // Pre-fill input text if we have a subject
    if (state.subject) {
      setInputText(state.subject);
    }
  }, []); 

  // Cleanup audio on unmount or step change
  useEffect(() => {
    return () => {
       if (audioRef.current) {
         audioRef.current.pause();
         audioRef.current = null;
       }
    };
  }, [state.step]);

  // Sync Active Course Progress to Library State & Firestore
  useEffect(() => {
    if (state.activeCourseId && state.library.length > 0) {
      const activeCourseIndex = state.library.findIndex(c => c.id === state.activeCourseId);
      
      if (activeCourseIndex !== -1) {
        const activeCourse = state.library[activeCourseIndex];
        
        // Check if there are actual changes to persist to avoid unnecessary writes
        const hasChanges = 
           activeCourse.completedSubLessons.length !== state.completedSubLessons.length ||
           Object.keys(activeCourse.subLessonFeedback).length !== Object.keys(state.subLessonFeedback).length ||
           (state.curriculum?.audioData && !activeCourse.curriculum.audioData);

        if (hasChanges) {
           const updatedCourse: SavedCourse = {
              ...activeCourse,
              completedSubLessons: state.completedSubLessons,
              subLessonFeedback: state.subLessonFeedback,
              curriculum: state.curriculum || activeCourse.curriculum,
              lastAccessed: Date.now()
           };

           // Update Local State
           setState(prev => {
             const updatedLibrary = [...prev.library];
             updatedLibrary[activeCourseIndex] = updatedCourse;
             return { ...prev, library: updatedLibrary };
           });
           
           // Sync to Firestore if db is available
           if (state.user && db) {
             const courseRef = doc(db, `users/${state.user.id}/courses/${activeCourse.id}`);
             setDoc(courseRef, updatedCourse, { merge: true }).catch(err => console.error("Firestore sync error:", err));
           }
        }
      }
    }
  }, [state.completedSubLessons, state.subLessonFeedback, state.curriculum?.audioData]);

  // Save active session state to local storage (for refresh handling)
  useEffect(() => {
    const cleanHistory = state.chatHistory.filter(m => !m.isThinking);
    const stateToSave = { 
      ...state, 
      chatHistory: cleanHistory,
      isLoading: false, 
      error: null 
    };
    
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
        if (state.step === AppStep.CURRICULUM) {
             setIsSaved(true);
             setSaveError(null);
        }
    } catch (e) {
        console.error("Failed to save state to localStorage", e);
        setSaveError("Storage limit reached.");
    }
    
    const timer = setTimeout(() => setIsSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.chatHistory]);

  // Handlers
  
  const handleGoogleLogin = async () => {
    setIsAuthLoading(true);
    try {
      const userResult = await signInWithGoogle();
      
      // If we are in Mock mode (auth is null), we need to manually update state
      // because onAuthStateChanged won't fire.
      if (!auth && userResult) {
         const user: User = {
           id: (userResult as any).uid,
           name: (userResult as any).displayName || 'Demo Student',
           email: (userResult as any).email,
           photoURL: (userResult as any).photoURL,
           joinedAt: Date.now()
         };
         
         setState(prev => ({
           ...prev,
           user,
           step: AppStep.DASHBOARD
         }));
         setIsAuthLoading(false);
      }
      
    } catch (error) {
      console.error("Login failed", error);
      setIsAuthLoading(false);
    }
  };
  
  const handleLogout = async () => {
    await logoutUser();
    setState(INITIAL_STATE);
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleStartNewCourse = () => {
    setState(prev => ({
       ...prev,
       step: AppStep.INPUT,
       subject: '',
       selectedPillar: null,
       selectedPath: null,
       curriculum: null,
       activeCourseId: null,
       chatHistory: []
    }));
    setInputText('');
  };

  const handleDeleteCourse = async (courseId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Optimistic Update
    setState(prev => ({
      ...prev,
      library: prev.library.filter(c => c.id !== courseId)
    }));

    // Firestore Delete
    if (state.user && db) {
      try {
        await deleteDoc(doc(db, `users/${state.user.id}/courses/${courseId}`));
      } catch (err) {
        console.error("Failed to delete course", err);
      }
    }
  };

  const handleResumeCourse = (course: SavedCourse) => {
    setState(prev => ({
      ...prev,
      step: AppStep.CURRICULUM,
      activeCourseId: course.id,
      subject: course.subject,
      selectedPillar: course.pillar,
      selectedPath: course.path,
      curriculum: course.curriculum,
      completedSubLessons: course.completedSubLessons,
      subLessonFeedback: course.subLessonFeedback,
      chatHistory: [{ 
         id: 'resume',
         role: 'model',
         text: `Welcome back to **${course.path.title}**! Ready to continue learning?`,
         timestamp: Date.now()
      }]
    }));
    
    // Re-init chat context
    initializeChat(course.subject, course.pillar.title, course.path.title, course.curriculum);
  };

  const handleSubjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    
    setState(prev => ({ ...prev, isLoading: true, subject: inputText, error: null }));
    
    try {
      const pillars = await generatePillars(inputText);
      setState(prev => ({
        ...prev,
        isLoading: false,
        pillars,
        step: AppStep.PILLARS,
      }));
    } catch (err) {
      setState(prev => ({ ...prev, isLoading: false, error: (err as Error).message }));
    }
  };

  const handlePillarSelect = async (pillar: LearningPillar) => {
    setState(prev => ({ ...prev, isLoading: true, selectedPillar: pillar, error: null }));
    
    try {
      const paths = await generateLessonPaths(state.subject, pillar.title);
      setState(prev => ({
        ...prev,
        isLoading: false,
        paths,
        step: AppStep.PATHS,
      }));
    } catch (err) {
      setState(prev => ({ ...prev, isLoading: false, error: (err as Error).message }));
    }
  };

  const handlePathSelect = async (path: LessonPath) => {
    setState(prev => ({ ...prev, isLoading: true, selectedPath: path, error: null }));
    
    try {
      if (!state.selectedPillar) throw new Error("Pillar not selected");
      const curriculum = await generateCurriculum(state.subject, state.selectedPillar.title, path.title);
      
      // Create new Saved Course
      const newCourseId = Date.now().toString();
      const newCourse: SavedCourse = {
        id: newCourseId,
        subject: state.subject,
        pillar: state.selectedPillar,
        path: path,
        curriculum: curriculum,
        completedSubLessons: [],
        subLessonFeedback: {},
        createdAt: Date.now(),
        lastAccessed: Date.now()
      };

      // Initialize chat session
      initializeChat(state.subject, state.selectedPillar.title, path.title, curriculum);
      
      // Update State & Library
      setState(prev => ({
        ...prev,
        isLoading: false,
        curriculum,
        completedSubLessons: [],
        subLessonFeedback: {},
        step: AppStep.CURRICULUM,
        activeCourseId: newCourseId,
        library: [newCourse, ...prev.library], // Add to local library state
        chatHistory: [{
          id: 'welcome',
          role: 'model',
          text: `Hi! I'm your tutor for **${path.title}**. We'll cover ${curriculum.objectives.length} main objectives today. Ask me anything as you go through the material!`,
          timestamp: Date.now()
        }]
      }));

      // Save to Firestore
      if (state.user && db) {
         try {
           await setDoc(doc(db, `users/${state.user.id}/courses/${newCourseId}`), newCourse);
         } catch (err) {
           console.error("Failed to save new course to Firestore", err);
         }
      }

    } catch (err) {
      setState(prev => ({ ...prev, isLoading: false, error: (err as Error).message }));
    }
  };

  const toggleSubLesson = (index: number) => {
    setState(prev => {
      const isCompleted = prev.completedSubLessons.includes(index);
      const newCompleted = isCompleted
        ? prev.completedSubLessons.filter(i => i !== index)
        : [...prev.completedSubLessons, index];
      return { ...prev, completedSubLessons: newCompleted };
    });
  };

  const handleSubLessonFeedback = (index: number, type: 'helpful' | 'unhelpful') => {
    setState(prev => ({
      ...prev,
      subLessonFeedback: {
        ...prev.subLessonFeedback,
        [index]: type
      }
    }));
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: chatInput,
      timestamp: Date.now()
    };

    setState(prev => ({
      ...prev,
      chatHistory: [...prev.chatHistory, userMsg, {
        id: 'thinking',
        role: 'model',
        text: '',
        timestamp: Date.now(),
        isThinking: true
      }]
    }));
    setChatInput('');

    try {
      const responseText = await sendMessageToTutor(userMsg.text);
      setState(prev => ({
        ...prev,
        chatHistory: prev.chatHistory.filter(m => !m.isThinking).concat({
          id: (Date.now() + 1).toString(),
          role: 'model',
          text: responseText,
          timestamp: Date.now()
        })
      }));
    } catch (err) {
      console.error(err);
      // Remove thinking state if error
      setState(prev => ({
        ...prev,
        chatHistory: prev.chatHistory.filter(m => !m.isThinking)
      }));
    }
  };

  const goBack = () => {
    setState(prev => {
      // If going back from curriculum, go to dashboard
      if (prev.step === AppStep.CURRICULUM) {
        stopAudio();
        return { 
          ...prev, 
          step: AppStep.DASHBOARD, 
          activeCourseId: null,
          curriculum: null 
        };
      }
      if (prev.step === AppStep.PATHS) return { ...prev, step: AppStep.PILLARS, paths: [], selectedPillar: null };
      if (prev.step === AppStep.PILLARS) return { ...prev, step: AppStep.INPUT, pillars: [], subject: '' };
      if (prev.step === AppStep.INPUT) return { ...prev, step: AppStep.DASHBOARD };
      return prev;
    });
  };

  // --- Audio Player Logic ---

  // Initialize audio element if curriculum has audioData
  useEffect(() => {
    if (state.curriculum?.audioData && !audioRef.current) {
       const blob = pcmToWav(state.curriculum.audioData);
       const url = URL.createObjectURL(blob);
       const audio = new Audio(url);
       audio.onended = () => setIsPlayingAudio(false);
       audioRef.current = audio;
    }
  }, [state.curriculum]);

  const stopAudio = () => {
    if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setIsPlayingAudio(false);
    }
  };

  const toggleAudio = async () => {
    if (!state.curriculum) return;

    // If audio is already loaded/playing
    if (audioRef.current) {
        if (isPlayingAudio) {
            audioRef.current.pause();
            setIsPlayingAudio(false);
        } else {
            audioRef.current.playbackRate = playbackRate;
            try {
                await audioRef.current.play();
                setIsPlayingAudio(true);
            } catch (e) {
                console.error("Playback failed", e);
            }
        }
        return;
    }

    // Generate Audio if not exists
    setIsLoadingAudio(true);
    try {
      const script = `
        Welcome to the module: ${state.curriculum.pathTitle}.
        ${state.curriculum.introduction}
        
        In this module, we will focus on the following key concepts: ${state.curriculum.keyConcepts.join(', ')}.
        
        Here is an overview of the lessons:
        ${state.curriculum.subLessons.map((l, i) => `Lesson ${i+1}: ${l.title}. ${l.content}`).join('. ')}
        
        Let's get started.
      `.trim();

      const base64Audio = await generateModuleAudio(script);

      // Update local state first
      setState(prev => {
          if (!prev.curriculum) return prev;
          return {
              ...prev,
              curriculum: {
                  ...prev.curriculum,
                  audioData: base64Audio
              }
          };
      });
      
      // Initialize Player immediately without waiting for next render effect
      const blob = pcmToWav(base64Audio);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => setIsPlayingAudio(false);
      audio.playbackRate = playbackRate;
      audioRef.current = audio;
      
      await audio.play();
      setIsPlayingAudio(true);

    } catch (err) {
      console.error("Failed to generate/play audio:", err);
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const changePlaybackSpeed = () => {
      const speeds = [1, 1.25, 1.5, 2];
      const nextSpeedIndex = (speeds.indexOf(playbackRate) + 1) % speeds.length;
      const nextSpeed = speeds[nextSpeedIndex];
      
      setPlaybackRate(nextSpeed);
      if (audioRef.current) {
          audioRef.current.playbackRate = nextSpeed;
      }
  };


  // Render Helpers
  const getIconForPillar = (iconName?: string) => {
    const className = "w-5 h-5";
    switch (iconName?.toLowerCase()) {
      case 'tech': return <Cpu className={className} />;
      case 'science': return <Beaker className={className} />;
      case 'art': return <Palette className={className} />;
      case 'business': return <Briefcase className={className} />;
      case 'globe': case 'nature': return <Globe className={className} />; // Map nature to globe/leaf
      case 'nature': return <Leaf className={className} />;
      case 'health': return <HeartPulse className={className} />;
      case 'history': return <Hourglass className={className} />;
      case 'math': return <Calculator className={className} />;
      case 'law': return <Scale className={className} />;
      case 'music': return <Music className={className} />;
      case 'philosophy': case 'lightbulb': return <Lightbulb className={className} />;
      case 'social': return <Users className={className} />;
      case 'data': return <Database className={className} />;
      case 'language': return <MessageCircle className={className} />;
      case 'psychology': return <Brain className={className} />;
      default: return <Layers className={className} />;
    }
  };

  const renderBreadcrumbs = () => (
    <div className="flex items-center space-x-2 text-sm text-gray-500 mb-4 overflow-x-auto whitespace-nowrap pb-2">
      {state.step !== AppStep.INPUT && state.step !== AppStep.DASHBOARD && (
        <button onClick={goBack} className="hover:text-green-600 transition-colors">Back</button>
      )}
      {state.step !== AppStep.DASHBOARD && state.step !== AppStep.AUTH && (
          <>
             <ChevronRight className="w-4 h-4" />
             <button onClick={() => setState(prev => ({...prev, step: AppStep.DASHBOARD, activeCourseId: null, curriculum: null }))} className="hover:text-green-600 transition-colors">Dashboard</button>
          </>
      )}
      {state.subject && (
        <>
          <ChevronRight className="w-4 h-4" />
          <span className={state.step === AppStep.PILLARS ? "font-semibold text-black" : ""}>{state.subject}</span>
        </>
      )}
      {state.selectedPillar && (
        <>
          <ChevronRight className="w-4 h-4" />
          <button 
            onClick={() => setState(prev => ({ ...prev, step: AppStep.PILLARS, selectedPath: null, curriculum: null }))}
            className={state.step === AppStep.PATHS ? "font-semibold text-black" : "hover:text-green-600 transition-colors"}
          >
            {state.selectedPillar.title}
          </button>
        </>
      )}
      {state.selectedPath && (
        <>
          <ChevronRight className="w-4 h-4" />
          <span className="font-semibold text-black truncate max-w-[150px]">{state.selectedPath.title}</span>
        </>
      )}
    </div>
  );

  return (
    <>
      {/* Session Saved Indicator */}
      {isSaved && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 text-xs font-medium border border-gray-800 pointer-events-none">
          <Save className="w-4 h-4 text-green-500" />
          <span className="tracking-wide">PROGRESS SAVED</span>
        </div>
      )}
      {saveError && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in bg-red-900 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 text-xs font-medium border border-red-800">
          <span className="tracking-wide">{saveError}</span>
        </div>
      )}

      {/* VIEW 0: AUTHENTICATION */}
      {state.step === AppStep.AUTH && (
         <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-200 flex items-center justify-center p-4">
             <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden animate-slide-up border border-gray-100">
                <div className="bg-black p-8 text-center text-white">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 text-green-500" />
                  <h1 className="text-3xl font-bold mb-2 tracking-tight">CogniPath</h1>
                  <p className="text-gray-400">Adaptive AI Tutor</p>
                </div>
                <div className="p-8">
                   {isAuthLoading ? (
                      <div className="flex justify-center py-4">
                        <div className="w-8 h-8 border-4 border-gray-200 border-t-green-600 rounded-full animate-spin"></div>
                      </div>
                   ) : (
                     <div className="space-y-6">
                        <div className="text-center">
                          <h2 className="text-lg font-semibold text-gray-800">Welcome Back</h2>
                          <p className="text-sm text-gray-500 mt-1">
                             {auth ? "Sign in to save your learning journey" : "Sign in to start learning (Demo Mode)"}
                          </p>
                        </div>
                        
                        <button 
                           onClick={handleGoogleLogin}
                           className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center shadow-sm group"
                        >
                           <Google className="w-5 h-5 mr-3" />
                           {auth ? "Sign in with Google" : "Enter Demo Mode"}
                        </button>
                        
                        <p className="text-xs text-center text-gray-400 mt-4">
                          By continuing, you agree to our Terms and Privacy Policy.
                        </p>
                     </div>
                   )}
                </div>
             </div>
         </div>
      )}

      {/* VIEW 0.5: DASHBOARD */}
      {state.step === AppStep.DASHBOARD && state.user && (
         <div className="h-screen flex flex-col bg-surface overflow-hidden">
            <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm z-10">
               <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
                  <div className="flex items-center">
                     <BookOpen className="w-6 h-6 text-green-600 mr-2" />
                     <span className="font-bold text-lg tracking-tight">CogniPath</span>
                  </div>
                  <div className="flex items-center space-x-4">
                     <div className="flex items-center space-x-2">
                        {state.user.photoURL ? (
                           <img src={state.user.photoURL} alt="User" className="w-8 h-8 rounded-full border border-gray-200" />
                        ) : (
                           <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                             <UserIcon className="w-4 h-4" />
                           </div>
                        )}
                        <span className="text-sm font-medium text-gray-700 hidden sm:block">
                           {state.user.name}
                        </span>
                     </div>
                     <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 transition-colors p-2" title="Logout">
                        <LogOut className="w-4 h-4" />
                     </button>
                  </div>
               </div>
            </header>

            <main className="flex-1 overflow-y-auto p-6 lg:p-10 custom-scrollbar bg-gray-50">
               <div className="max-w-7xl mx-auto">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                     <div>
                        <h1 className="text-3xl font-bold text-gray-900">Your Learning Library</h1>
                        <p className="text-gray-500 mt-1">Pick up where you left off or start a new path.</p>
                     </div>
                     <button 
                        onClick={handleStartNewCourse}
                        className="bg-black text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors flex items-center shadow-lg shadow-black/10"
                     >
                        <Plus className="w-4 h-4 mr-2" /> Start New Journey
                     </button>
                  </div>

                  {state.library.length === 0 ? (
                     <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-300">
                        <LayoutGrid className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900">No courses yet</h3>
                        <p className="text-gray-500 mb-6">Start your first learning journey to see it here.</p>
                        <button onClick={handleStartNewCourse} className="text-green-600 hover:underline">Browse Subjects</button>
                     </div>
                  ) : (
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {state.library.map(course => {
                           const progress = Math.round((course.completedSubLessons.length / course.curriculum.subLessons.length) * 100);
                           return (
                              <div key={course.id} onClick={() => handleResumeCourse(course)} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-green-400 transition-all cursor-pointer group relative overflow-hidden">
                                 <div className="p-6">
                                    <div className="flex justify-between items-start mb-4">
                                       <div className="w-10 h-10 bg-green-50 text-green-600 rounded-lg flex items-center justify-center">
                                          {getIconForPillar(course.pillar.icon)}
                                       </div>
                                       <button 
                                          onClick={(e) => handleDeleteCourse(course.id, e)}
                                          className="text-gray-300 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-colors z-20 relative"
                                          title="Delete Course"
                                       >
                                          <Trash className="w-4 h-4" />
                                       </button>
                                    </div>
                                    <h3 className="text-lg font-bold text-gray-900 mb-1 line-clamp-1 group-hover:text-green-600 transition-colors">{course.path.title}</h3>
                                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-4">{course.subject} • {course.pillar.title}</p>
                                    
                                    <div className="space-y-2">
                                       <div className="flex justify-between text-xs font-medium">
                                          <span className="text-gray-600">{progress}% Complete</span>
                                          <span className="text-green-600">{course.completedSubLessons.length}/{course.curriculum.subLessons.length}</span>
                                       </div>
                                       <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                          <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${progress}%` }}></div>
                                       </div>
                                    </div>
                                 </div>
                                 <div className="bg-gray-50 px-6 py-3 border-t border-gray-100 flex justify-between items-center">
                                    <span className="text-xs text-gray-400">Last accessed {new Date(course.lastAccessed).toLocaleDateString()}</span>
                                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-green-600" />
                                 </div>
                              </div>
                           );
                        })}
                     </div>
                  )}
               </div>
            </main>
         </div>
      )}


      {/* VIEW 1: Input Subject */}
      {state.step === AppStep.INPUT && (
        <div className="min-h-screen bg-gray-50 flex flex-col">
          <header className="bg-white border-b border-gray-200 px-6 py-4">
             <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
                {renderBreadcrumbs()}
             </div>
          </header>
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl overflow-hidden animate-slide-up border border-gray-100">
              <div className="p-8">
                <h2 className="text-2xl font-bold text-center mb-6">What do you want to master today?</h2>
                <form onSubmit={handleSubjectSubmit} className="space-y-6">
                  <div>
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="e.g., Quantum Physics, French Cooking, React Native..."
                      className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all placeholder-gray-400"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={state.isLoading}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center disabled:opacity-70"
                  >
                    {state.isLoading ? (
                      <span className="animate-pulse">Analyzing Subject...</span>
                    ) : (
                      <>
                        Start Learning Journey
                        <ChevronRight className="w-5 h-5 ml-2" />
                      </>
                    )}
                  </button>
                </form>
                <div className="mt-8 pt-6 border-t border-gray-100 text-center">
                  <p className="text-xs text-gray-400">Powered by Gemini 2.5 Flash</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading Screen for subsequent steps */}
      {state.isLoading && state.step !== AppStep.INPUT && (
         <div className="h-screen bg-surface flex flex-col">
            <header className="bg-white border-b border-gray-200 px-6 py-4">
               <div className="max-w-7xl mx-auto w-full">
                 {renderBreadcrumbs()}
               </div>
            </header>
            <div className="flex-1 flex items-center justify-center">
               <Loading message={state.step === AppStep.PILLARS ? `Deconstructing ${state.subject}...` : state.step === AppStep.PATHS ? `Mapping routes for ${state.selectedPillar?.title}...` : `Building curriculum for ${state.selectedPath?.title}...`} />
            </div>
         </div>
      )}

      {/* VIEW 2: Pillars Grid */}
      {!state.isLoading && state.step === AppStep.PILLARS && (
        <div className="h-screen flex flex-col bg-surface overflow-hidden">
          <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm z-10">
            <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
              {renderBreadcrumbs()}
              <button onClick={goBack} className="text-sm text-gray-500 hover:text-black flex items-center transition-colors">
                <ArrowLeft className="w-4 h-4 mr-1" /> Change Subject
              </button>
            </div>
            <div className="max-w-7xl mx-auto w-full mt-2">
              <h2 className="text-2xl font-bold text-black">Learning Pillars: {state.subject}</h2>
              <p className="text-gray-500">Select a pillar to explore focused lesson paths.</p>
            </div>
          </header>
          
          <main className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <div className="max-w-7xl mx-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {state.pillars.map((pillar) => (
                  <button
                    key={pillar.id}
                    onClick={() => handlePillarSelect(pillar)}
                    className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-green-400 transition-all text-left flex flex-col h-full group animate-slide-up"
                    style={{ animationDelay: `${pillar.id * 50}ms` }}
                  >
                    <div className="w-10 h-10 bg-green-50 text-green-600 rounded-lg flex items-center justify-center mb-4 group-hover:bg-green-600 group-hover:text-white transition-colors">
                      {getIconForPillar(pillar.icon)}
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-2 group-hover:text-green-600 transition-colors">{pillar.title}</h3>
                    <p className="text-sm text-gray-500 line-clamp-3">{pillar.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </main>
        </div>
      )}

      {/* VIEW 3: Lesson Paths */}
      {!state.isLoading && state.step === AppStep.PATHS && (
        <div className="h-screen flex flex-col bg-surface overflow-hidden">
          <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm z-10">
            <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
              {renderBreadcrumbs()}
              <button onClick={goBack} className="text-sm text-gray-500 hover:text-black flex items-center transition-colors">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Pillars
              </button>
            </div>
            <div className="max-w-7xl mx-auto w-full mt-2">
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 bg-green-50 text-green-600 rounded-lg flex items-center justify-center">
                    {getIconForPillar(state.selectedPillar?.icon)}
                 </div>
                 <div>
                    <h2 className="text-2xl font-bold text-black">{state.selectedPillar?.title} Paths</h2>
                 </div>
              </div>
              <p className="text-gray-500 mt-2">Choose a path to generate your curriculum.</p>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <div className="max-w-4xl mx-auto space-y-4">
              {state.paths.map((path, idx) => (
                <button
                  key={path.id}
                  onClick={() => handlePathSelect(path)}
                  className="w-full bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-green-400 transition-all text-left flex items-start group animate-slide-up"
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  <div className="mr-6 mt-1">
                     <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg
                        ${path.difficulty === 'Beginner' ? 'bg-green-600' : 
                          path.difficulty === 'Intermediate' ? 'bg-yellow-600' : 'bg-red-600'}`
                     }>
                        {idx + 1}
                     </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-lg font-bold text-gray-900 group-hover:text-green-600 transition-colors">{path.title}</h3>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium
                        ${path.difficulty === 'Beginner' ? 'bg-green-100 text-green-700' : 
                          path.difficulty === 'Intermediate' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`
                      }>
                        {path.difficulty}
                      </span>
                    </div>
                    <p className="text-gray-600 mb-2">{path.description}</p>
                    <div className="flex items-center text-xs text-gray-400">
                      <span className="flex items-center mr-4"><Compass className="w-3 h-3 mr-1"/> {path.estimatedTime}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-gray-300 group-hover:text-green-600 transition-colors self-center ml-4" />
                </button>
              ))}
            </div>
          </main>
        </div>
      )}

      {/* VIEW 4: Curriculum + Chat (Split View) */}
      {!state.isLoading && state.step === AppStep.CURRICULUM && state.curriculum && (
        <div className="h-screen flex flex-col bg-surface overflow-hidden">
          <header className="bg-white border-b border-gray-200 px-4 py-3 shadow-sm z-20">
            <div className="w-full flex items-center justify-between">
              {renderBreadcrumbs()}
              <div className="flex items-center gap-4">
                 <button onClick={goBack} className="text-sm text-gray-500 hover:text-black flex items-center transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
                 </button>
              </div>
            </div>
          </header>

          <div className="flex-1 flex overflow-hidden">
            {/* Left Panel: Curriculum Content */}
            <div className="flex-1 overflow-y-auto p-6 lg:p-10 custom-scrollbar border-r border-gray-200 bg-white">
               <div className="max-w-3xl mx-auto animate-fade-in pb-12">
                  <div className="flex items-start justify-between mb-4">
                     <div>
                       <span className="text-green-600 font-semibold tracking-wide text-xs uppercase mb-1 block">Current Module</span>
                       <h1 className="text-3xl lg:text-4xl font-bold text-gray-900">{state.curriculum.pathTitle}</h1>
                     </div>
                     
                     {/* Audio Player Controls */}
                     <div className="flex items-center bg-gray-50 rounded-full border border-gray-200 p-1 shadow-sm">
                       {isLoadingAudio ? (
                          <div className="px-4 py-2 flex items-center text-xs text-gray-500 font-medium">
                             <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce mr-2"></span> Generating...
                          </div>
                       ) : (
                          <>
                             <button 
                               onClick={toggleAudio}
                               className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors mr-1
                                 ${isPlayingAudio ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'}`}
                               title={isPlayingAudio ? "Pause Overview" : "Play Overview"}
                             >
                               {isPlayingAudio ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                             </button>
                             
                             {(isPlayingAudio || audioRef.current) && (
                               <>
                                 <button 
                                   onClick={stopAudio}
                                   className="w-9 h-9 rounded-full flex items-center justify-center bg-white text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors mr-1"
                                   title="Stop"
                                 >
                                   <Square className="w-3 h-3 fill-current" />
                                 </button>
                                 <button
                                   onClick={changePlaybackSpeed}
                                   className="h-9 px-3 rounded-full flex items-center justify-center bg-white text-xs font-bold text-gray-600 hover:bg-green-50 hover:text-green-600 transition-colors border-l border-gray-200 ml-1"
                                   title="Playback Speed"
                                 >
                                   <FastForward className="w-3 h-3 mr-1" /> {playbackRate}x
                                 </button>
                               </>
                             )}
                             
                             {(!isPlayingAudio && !audioRef.current) && (
                                <button 
                                  onClick={toggleAudio} 
                                  className="px-4 text-xs font-semibold text-gray-600 hover:text-green-600"
                                >
                                  Listen to Overview
                                </button>
                             )}
                          </>
                       )}
                     </div>
                  </div>
                  
                  {state.curriculum.introduction && (
                    <p className="text-gray-600 text-lg leading-relaxed mb-8">
                      {state.curriculum.introduction}
                    </p>
                  )}

                  {/* Progress Bar */}
                  <div className="mb-10 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold text-gray-700 text-sm">Course Progress</span>
                      <span className="text-sm font-bold text-green-600">{Math.round((state.completedSubLessons.length / state.curriculum.subLessons.length) * 100)}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                      <div 
                        className="bg-green-600 h-2.5 rounded-full transition-all duration-500 ease-out" 
                        style={{ width: `${Math.round((state.completedSubLessons.length / state.curriculum.subLessons.length) * 100)}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Real World Context Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                     {/* Why It Matters */}
                     <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                        <h3 className="flex items-center text-lg font-bold text-black mb-3">
                           <Globe className="w-5 h-5 mr-2 text-green-600" /> Real World Context
                        </h3>
                        <ul className="space-y-2">
                           {state.curriculum.realWorldUseCases?.map((useCase, i) => (
                             <li key={i} className="flex items-start text-sm text-gray-700">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 mr-2 flex-shrink-0"></span>
                                {useCase}
                             </li>
                           ))}
                        </ul>
                     </div>
                     
                     {/* Case Study */}
                     <div className="bg-gray-900 text-white rounded-xl p-6 shadow-md relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                           <Briefcase className="w-24 h-24" />
                        </div>
                        <h3 className="flex items-center text-lg font-bold mb-2 relative z-10">
                           Case Study
                        </h3>
                        {state.curriculum.caseStudy && (
                          <div className="relative z-10 text-sm">
                             <h4 className="font-semibold text-green-400 mb-1">{state.curriculum.caseStudy.title}</h4>
                             <p className="text-gray-300 mb-2 italic">"{state.curriculum.caseStudy.scenario}"</p>
                             <div className="mt-2 pt-2 border-t border-gray-700">
                                <span className="text-xs uppercase tracking-wider text-gray-500">Outcome</span>
                                <p className="text-gray-200">{state.curriculum.caseStudy.outcome}</p>
                             </div>
                          </div>
                        )}
                     </div>
                  </div>

                  {/* Objectives & Concepts */}
                  <div className="mb-10">
                    <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                       <Target className="w-5 h-5 mr-2" /> Core Concepts & Objectives
                    </h3>
                    <div className="flex flex-wrap gap-2 mb-4">
                        {state.curriculum.keyConcepts.map((concept, i) => (
                          <span key={i} className="bg-white text-gray-800 px-3 py-1.5 rounded-full text-sm font-medium border border-gray-200 shadow-sm">
                            {concept}
                          </span>
                        ))}
                     </div>
                    <ul className="grid grid-cols-1 gap-2">
                      {state.curriculum.objectives.map((obj, i) => (
                        <li key={i} className="flex items-start text-gray-600 text-sm">
                          <CheckCircle className="w-4 h-4 text-green-600 mr-2 mt-0.5 flex-shrink-0" />
                          <span>{obj}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Lessons */}
                  <div className="space-y-8">
                    <h3 className="text-2xl font-bold text-gray-900 border-b border-gray-200 pb-2">Lesson Modules</h3>
                    {state.curriculum.subLessons.map((lesson, i) => {
                      const isCompleted = state.completedSubLessons.includes(i);
                      const feedback = state.subLessonFeedback[i];
                      
                      return (
                        <div key={i} className={`relative pl-8 border-l-2 pb-12 last:pb-0 last:border-l-0 transition-colors ${isCompleted ? 'border-green-200' : 'border-gray-200'}`}>
                          <button 
                            onClick={() => toggleSubLesson(i)}
                            className={`absolute -left-[11px] top-0 w-6 h-6 rounded-full ring-4 ring-white flex items-center justify-center transition-all cursor-pointer shadow-sm ${isCompleted ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-white border-2 border-gray-300 hover:border-black'}`}
                            title={isCompleted ? "Mark as incomplete" : "Mark as complete"}
                          >
                             {isCompleted && <Check className="w-3.5 h-3.5 animate-scale-in" />}
                          </button>
                          
                          <div className={`transition-all duration-300 ${isCompleted ? 'opacity-50 grayscale' : 'opacity-100'}`}>
                             <h4 className={`text-xl font-bold mb-2 flex items-center ${isCompleted ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                                {lesson.title}
                                {isCompleted && <span className="ml-3 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium no-underline inline-block animate-scale-in">Completed</span>}
                             </h4>
                             
                             <p className="text-gray-600 mb-6 italic text-sm border-l-2 border-gray-300 pl-3">{lesson.content}</p>

                             {/* General Concepts */}
                             {lesson.generalConcepts && (
                               <div className="mb-6">
                                 <h5 className="flex items-center font-bold text-gray-800 mb-2">
                                   <Lightbulb className="w-4 h-4 mr-2 text-yellow-500" />
                                   General Concepts
                                 </h5>
                                 <div className="prose prose-sm prose-slate max-w-none text-gray-700 bg-yellow-50/50 p-4 rounded-lg border border-yellow-100">
                                   <ReactMarkdown>{lesson.generalConcepts}</ReactMarkdown>
                                 </div>
                               </div>
                             )}

                             {/* Use Cases & Case Studies Grid */}
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                {/* Use Cases */}
                                {lesson.useCases && lesson.useCases.length > 0 && (
                                   <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                      <h5 className="flex items-center font-bold text-gray-800 mb-3 text-sm">
                                         <Wrench className="w-4 h-4 mr-2 text-blue-500" /> Use Cases
                                      </h5>
                                      <ul className="space-y-2">
                                        {lesson.useCases.map((uc, idx) => (
                                          <li key={idx} className="flex items-start text-xs text-gray-600">
                                             <span className="w-1 h-1 rounded-full bg-blue-500 mt-1.5 mr-2 flex-shrink-0"></span>
                                             {uc}
                                          </li>
                                        ))}
                                      </ul>
                                   </div>
                                )}

                                {/* Case Studies */}
                                {lesson.caseStudies && lesson.caseStudies.length > 0 && (
                                   <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                      <h5 className="flex items-center font-bold text-gray-800 mb-3 text-sm">
                                         <Briefcase className="w-4 h-4 mr-2 text-purple-500" /> Case Studies
                                      </h5>
                                      <ul className="space-y-2">
                                        {lesson.caseStudies.map((cs, idx) => (
                                          <li key={idx} className="flex items-start text-xs text-gray-600">
                                             <span className="w-1 h-1 rounded-full bg-purple-500 mt-1.5 mr-2 flex-shrink-0"></span>
                                             {cs}
                                          </li>
                                        ))}
                                      </ul>
                                   </div>
                                )}
                             </div>

                             {/* References & Visuals Grid */}
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                               {/* References */}
                               {lesson.references && lesson.references.length > 0 && (
                                 <div className="bg-white border border-gray-200 rounded-lg p-4">
                                   <h5 className="flex items-center font-bold text-gray-800 mb-2 text-sm">
                                      <BookOpen className="w-4 h-4 mr-2 text-gray-500" /> References
                                   </h5>
                                   <div className="flex flex-wrap gap-2">
                                      {lesson.references.map((ref, idx) => {
                                        const isUrl = ref.startsWith('http://') || ref.startsWith('https://');
                                        return isUrl ? (
                                           <a 
                                             key={idx} 
                                             href={ref} 
                                             target="_blank" 
                                             rel="noopener noreferrer" 
                                             className="bg-green-50 text-green-700 hover:bg-green-100 hover:underline text-xs px-2 py-1 rounded border border-green-200 flex items-center transition-colors group"
                                             title={ref}
                                           >
                                              <ExternalLink className="w-3 h-3 mr-1 flex-shrink-0" />
                                              <span className="truncate max-w-[150px]">
                                                {ref.length > 25 ? 'Open Resource' : ref}
                                              </span>
                                           </a>
                                        ) : (
                                          <span key={idx} className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded border border-gray-200">
                                            {ref}
                                          </span>
                                        );
                                      })}
                                   </div>
                                 </div>
                               )}
                               
                               {/* Visual Aid */}
                               <div className="bg-white">
                                  <h5 className="flex items-center font-bold text-gray-800 mb-2 text-sm">
                                      <Image className="w-4 h-4 mr-2 text-indigo-500" /> Visual Concept
                                   </h5>
                                  <LessonVisual description={lesson.visualDescription} />
                               </div>
                             </div>

                             {/* Example Box */}
                             {lesson.example && (
                               <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-r-lg mb-4">
                                  <span className="font-bold text-green-800 text-xs uppercase tracking-wide block mb-1">Example</span>
                                  <p className="text-gray-800 text-sm">{lesson.example}</p>
                               </div>
                             )}

                             {/* Action Item */}
                             <div className={`border rounded-lg p-4 transition-colors mb-4 bg-white shadow-sm border-gray-200`}>
                               <span className={`text-xs font-bold uppercase tracking-wider mb-1 block text-black`}>Action Item</span>
                               <p className={`text-sm font-medium text-gray-700`}>{lesson.actionItem}</p>
                             </div>

                             {/* Feedback Controls */}
                             <div className="flex items-center justify-end space-x-3 text-sm h-8">
                                {!feedback ? (
                                  <>
                                    <span className="text-gray-400 text-xs transition-opacity duration-300">Was this helpful?</span>
                                    <button 
                                      onClick={() => handleSubLessonFeedback(i, 'helpful')}
                                      className="p-1.5 rounded-md transition-all hover:bg-green-50 text-gray-400 hover:text-green-600 hover:scale-110 active:scale-95"
                                    >
                                      <ThumbsUp className="w-4 h-4" />
                                    </button>
                                    <button 
                                      onClick={() => handleSubLessonFeedback(i, 'unhelpful')}
                                      className="p-1.5 rounded-md transition-all hover:bg-red-50 text-gray-400 hover:text-red-600 hover:scale-110 active:scale-95"
                                    >
                                      <ThumbsDown className="w-4 h-4" />
                                    </button>
                                  </>
                                ) : (
                                  <div className="flex items-center space-x-2 animate-scale-in text-gray-500">
                                     <span className="text-xs font-medium italic">Thanks for feedback!</span>
                                     {feedback === 'helpful' ? (
                                        <div className="p-1.5 bg-green-100 text-green-600 rounded-md shadow-sm">
                                            <ThumbsUp className="w-4 h-4" />
                                        </div>
                                     ) : (
                                        <div className="p-1.5 bg-red-100 text-red-600 rounded-md shadow-sm">
                                            <ThumbsDown className="w-4 h-4" />
                                        </div>
                                     )}
                                  </div>
                                )}
                             </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Resources */}
                  {state.curriculum.resources && (
                     <div className="mt-12 bg-gray-50 rounded-xl p-6 border border-gray-200">
                        <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                           <BookOpen className="w-4 h-4 mr-2" /> Further Reading & Resources
                        </h3>
                        <div className="flex flex-wrap gap-2">
                           {state.curriculum.resources.map((res, i) => (
                              <span key={i} className="text-sm text-gray-600 bg-white border border-gray-200 px-3 py-1 rounded-md">
                                 {res}
                              </span>
                           ))}
                        </div>
                     </div>
                  )}

                  {/* Footer Expansion */}
                  <div className="mt-12 pt-8 border-t border-gray-200 text-center">
                    <p className="text-gray-500 italic mb-4">Ready for the next challenge?</p>
                    <button onClick={goBack} className="text-green-600 font-semibold hover:underline">
                      Explore other paths in {state.selectedPillar?.title}
                    </button>
                  </div>
               </div>
            </div>

            {/* Right Panel: Ask The Tutor */}
            <div className="w-full lg:w-[400px] xl:w-[450px] bg-gray-50 flex flex-col border-l border-gray-200 shadow-xl z-30">
              <div className="p-4 bg-white border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center">
                   <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center mr-3">
                      <MessageCircle className="w-4 h-4" />
                   </div>
                   <div>
                     <h3 className="font-bold text-gray-900 text-sm">Ask The Tutor</h3>
                     <p className="text-xs text-green-600 flex items-center"><span className="w-2 h-2 rounded-full bg-green-500 mr-1"></span> Online</p>
                   </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {state.chatHistory.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div 
                      className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed shadow-sm
                      ${msg.role === 'user' 
                        ? 'bg-black text-white rounded-br-none' 
                        : 'bg-white text-gray-800 border border-gray-200 rounded-bl-none'}`}
                    >
                       {msg.isThinking ? (
                          <div className="flex space-x-1 h-5 items-center">
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                          </div>
                       ) : (
                          <ReactMarkdown 
                            components={{
                              code({node, className, children, ...props}) {
                                return <code className="bg-gray-100 text-black border border-gray-300 rounded px-1 py-0.5 text-xs font-mono" {...props}>{children}</code>
                              }
                            }}
                          >
                            {msg.text}
                          </ReactMarkdown>
                       )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <div className="p-4 bg-white border-t border-gray-200">
                 <form onSubmit={handleSendMessage} className="relative">
                   <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask about any concept..."
                      className="w-full pl-4 pr-12 py-3 bg-gray-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none"
                      disabled={state.isLoading}
                   />
                   <button 
                     type="submit" 
                     disabled={!chatInput.trim() || state.isLoading}
                     className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-black transition-colors"
                   >
                     <Send className="w-4 h-4" />
                   </button>
                 </form>
                 <p className="text-[10px] text-gray-400 text-center mt-2">
                   AI can make mistakes. Verify important info.
                 </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default App;
