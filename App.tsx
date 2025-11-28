import React, { useState, useEffect, useRef } from 'react';
import { 
  AppStep, AppState, LearningPillar, LessonPath, Curriculum, ChatMessage 
} from './types';
import { 
  generatePillars, generateLessonPaths, generateCurriculum, initializeChat, sendMessageToTutor 
} from './services/geminiService';
import { 
  BookOpen, Compass, Layers, MessageCircle, Send, ChevronRight, ArrowLeft, CheckCircle, Target, Check, Save, ThumbsUp, ThumbsDown,
  Cpu, Beaker, Palette, Briefcase, Globe, HeartPulse, Hourglass, Calculator, Scale, Music, Lightbulb, Wrench, Brain, Leaf, Users, Database
} from './components/Icons';
import Loading from './components/Loading';
import ReactMarkdown from 'react-markdown';

const INITIAL_STATE: AppState = {
  step: AppStep.INPUT,
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

const STORAGE_KEY = 'cognipath_state';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(() => {
    // Lazy initialization to restore state from local storage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          // Merge with initial state to ensure new properties exist (like subLessonFeedback)
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
  const [isSaved, setIsSaved] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
    // Pre-fill input text if we have a subject but are back at input step for some reason, or just to sync
    if (state.subject) {
      setInputText(state.subject);
    }
  }, []); // Run once on mount

  // Save state to local storage whenever it changes
  useEffect(() => {
    // Ensure we don't save "thinking" messages or loading states to prevent stuck states on reload
    const cleanHistory = state.chatHistory.filter(m => !m.isThinking);
    const stateToSave = { 
      ...state, 
      chatHistory: cleanHistory,
      isLoading: false, 
      error: null 
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));

    // Show visual indicator
    setIsSaved(true);
    const timer = setTimeout(() => setIsSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.chatHistory]);

  // Handlers
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
      
      // Initialize chat session
      initializeChat(state.subject, state.selectedPillar.title, path.title, curriculum);
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        curriculum,
        completedSubLessons: [],
        subLessonFeedback: {},
        step: AppStep.CURRICULUM,
        chatHistory: [{
          id: 'welcome',
          role: 'model',
          text: `Hi! I'm your tutor for **${path.title}**. We'll cover ${curriculum.objectives.length} main objectives today. Ask me anything as you go through the material!`,
          timestamp: Date.now()
        }]
      }));
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
      if (prev.step === AppStep.CURRICULUM) {
        return { 
          ...prev, 
          step: AppStep.PATHS, 
          curriculum: null, 
          completedSubLessons: [], 
          subLessonFeedback: {},
          chatHistory: [] 
        };
      }
      if (prev.step === AppStep.PATHS) return { ...prev, step: AppStep.PILLARS, paths: [], selectedPillar: null };
      if (prev.step === AppStep.PILLARS) return { ...prev, step: AppStep.INPUT, pillars: [], subject: '' };
      return prev;
    });
  };

  const resetApp = () => {
    localStorage.removeItem(STORAGE_KEY);
    setState(INITIAL_STATE);
    setInputText('');
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
      {state.step !== AppStep.INPUT && (
        <button onClick={resetApp} className="hover:text-green-600 transition-colors">Home</button>
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

      {/* VIEW 1: Input Subject */}
      {state.step === AppStep.INPUT && (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-200 flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl overflow-hidden animate-slide-up border border-gray-100">
            <div className="bg-black p-8 text-center text-white">
              <BookOpen className="w-12 h-12 mx-auto mb-4 text-green-500" />
              <h1 className="text-3xl font-bold mb-2 tracking-tight">CogniPath</h1>
              <p className="text-gray-400">Your AI-Powered Adaptive Learning Coach</p>
            </div>
            <div className="p-8">
              <form onSubmit={handleSubjectSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">What do you want to master today?</label>
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
              <button onClick={goBack} className="text-sm text-gray-500 hover:text-black flex items-center transition-colors">
                 <ArrowLeft className="w-4 h-4 mr-1" /> Paths
              </button>
            </div>
          </header>

          <div className="flex-1 flex overflow-hidden">
            {/* Left Panel: Curriculum Content */}
            <div className="flex-1 overflow-y-auto p-6 lg:p-10 custom-scrollbar border-r border-gray-200 bg-white">
               <div className="max-w-3xl mx-auto animate-fade-in">
                  <span className="text-green-600 font-semibold tracking-wide text-sm uppercase">Current Module</span>
                  <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mt-2 mb-6">{state.curriculum.pathTitle}</h1>
                  
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
                    <div className="mt-2 text-right">
                      <span className="text-xs text-gray-500">{state.completedSubLessons.length} of {state.curriculum.subLessons.length} lessons completed</span>
                    </div>
                  </div>

                  {/* Objectives */}
                  <div className="mb-10 bg-gray-50 rounded-xl p-6 border border-gray-200">
                    <h3 className="flex items-center text-lg font-bold text-black mb-4">
                      <Target className="w-5 h-5 mr-2" /> Learning Objectives
                    </h3>
                    <ul className="space-y-3">
                      {state.curriculum.objectives.map((obj, i) => (
                        <li key={i} className="flex items-start">
                          <CheckCircle className="w-5 h-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-800">{obj}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Key Concepts */}
                  <div className="mb-10">
                     <h3 className="text-xl font-bold text-gray-900 mb-4 border-b border-gray-200 pb-2">Key Concepts</h3>
                     <div className="flex flex-wrap gap-2">
                        {state.curriculum.keyConcepts.map((concept, i) => (
                          <span key={i} className="bg-gray-100 text-gray-800 px-3 py-1.5 rounded-full text-sm font-medium border border-gray-200">
                            {concept}
                          </span>
                        ))}
                     </div>
                  </div>

                  {/* Lessons */}
                  <div className="space-y-8">
                    <h3 className="text-xl font-bold text-gray-900 border-b border-gray-200 pb-2">Lesson Modules</h3>
                    {state.curriculum.subLessons.map((lesson, i) => {
                      const isCompleted = state.completedSubLessons.includes(i);
                      const feedback = state.subLessonFeedback[i];
                      
                      return (
                        <div key={i} className={`relative pl-8 border-l-2 pb-8 last:pb-0 last:border-l-0 transition-colors ${isCompleted ? 'border-green-200' : 'border-gray-200'}`}>
                          <button 
                            onClick={() => toggleSubLesson(i)}
                            className={`absolute -left-[11px] top-0 w-6 h-6 rounded-full ring-4 ring-white flex items-center justify-center transition-all cursor-pointer shadow-sm ${isCompleted ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-white border-2 border-gray-300 hover:border-black'}`}
                            title={isCompleted ? "Mark as incomplete" : "Mark as complete"}
                            aria-label={isCompleted ? "Mark lesson as incomplete" : "Mark lesson as complete"}
                          >
                             {isCompleted && <Check className="w-3.5 h-3.5 animate-scale-in" />}
                          </button>
                          
                          <div className={`transition-all duration-300 ${isCompleted ? 'opacity-60' : 'opacity-100'}`}>
                             <h4 className={`text-lg font-bold mb-2 flex items-center ${isCompleted ? 'text-gray-500 line-through decoration-gray-400' : 'text-gray-800'}`}>
                                {lesson.title}
                                {isCompleted && <span className="ml-3 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium no-underline inline-block animate-scale-in">Completed</span>}
                             </h4>
                             <div className="prose prose-slate text-gray-600 mb-4">
                               <p>{lesson.content}</p>
                             </div>
                             <div className={`border rounded-lg p-4 transition-colors mb-4 ${isCompleted ? 'bg-gray-50 border-gray-200' : 'bg-gray-50 border-gray-200'}`}>
                               <span className={`text-xs font-bold uppercase tracking-wider mb-1 block ${isCompleted ? 'text-gray-500' : 'text-black'}`}>Action Item</span>
                               <p className={`text-sm font-medium ${isCompleted ? 'text-gray-600' : 'text-gray-700'}`}>{lesson.actionItem}</p>
                             </div>

                             {/* Feedback Controls */}
                             <div className="flex items-center justify-end space-x-3 text-sm h-8">
                                {!feedback ? (
                                  <>
                                    <span className="text-gray-400 text-xs transition-opacity duration-300">Was this helpful?</span>
                                    <button 
                                      onClick={() => handleSubLessonFeedback(i, 'helpful')}
                                      className="p-1.5 rounded-md transition-all hover:bg-green-50 text-gray-400 hover:text-green-600 hover:scale-110 active:scale-95"
                                      aria-label="Helpful"
                                    >
                                      <ThumbsUp className="w-4 h-4" />
                                    </button>
                                    <button 
                                      onClick={() => handleSubLessonFeedback(i, 'unhelpful')}
                                      className="p-1.5 rounded-md transition-all hover:bg-red-50 text-gray-400 hover:text-red-600 hover:scale-110 active:scale-95"
                                      aria-label="Not helpful"
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

                  {/* Footer Expansion */}
                  <div className="mt-16 pt-8 border-t border-gray-200 text-center">
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