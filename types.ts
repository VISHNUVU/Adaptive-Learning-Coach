

export enum AppStep {
  AUTH = 'AUTH',
  DASHBOARD = 'DASHBOARD',
  INPUT = 'INPUT',
  PILLARS = 'PILLARS',
  PATHS = 'PATHS',
  CURRICULUM = 'CURRICULUM',
}

export interface LearningPillar {
  id: number;
  title: string;
  description: string;
  icon?: string; // Placeholder for UI icon mapping
}

export interface LessonPath {
  id: number;
  title: string;
  description: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  estimatedTime: string;
}

export interface SubLesson {
  title: string;
  content: string; // Brief summary
  generalConcepts: string; // Deep dive explanation (Markdown supported) - formerly detailedContent
  useCases: string[]; // List of specific use cases
  caseStudies: string[]; // Brief case study examples relevant to this specific sub-lesson
  references: string[]; // Specific references/terms
  example: string; // Concrete example or analogy
  visualDescription: string; // Text description of a diagram/image to help understanding
  actionItem: string; // Practical task
}

export interface CaseStudy {
  title: string;
  scenario: string;
  outcome: string;
}

export interface Curriculum {
  pathTitle: string;
  introduction: string; // Engaging hook/intro
  objectives: string[];
  keyConcepts: string[];
  realWorldUseCases: string[]; // List of practical applications
  caseStudy: CaseStudy; // Specific narrative example
  subLessons: SubLesson[];
  resources: string[]; // Further reading/search terms
  audioData?: string; // Base64 PCM audio data for the module overview
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isThinking?: boolean;
}

export interface User {
  id: string;
  name: string;
  email?: string;
  photoURL?: string;
  joinedAt: number;
}

export interface SavedCourse {
  id: string;
  subject: string;
  pillar: LearningPillar;
  path: LessonPath;
  curriculum: Curriculum;
  completedSubLessons: number[];
  subLessonFeedback: Record<number, 'helpful' | 'unhelpful'>;
  createdAt: number;
  lastAccessed: number;
}

export interface AppState {
  step: AppStep;
  user: User | null;
  library: SavedCourse[];
  activeCourseId: string | null;
  
  // Active Session State
  subject: string;
  selectedPillar: LearningPillar | null;
  selectedPath: LessonPath | null;
  curriculum: Curriculum | null;
  completedSubLessons: number[]; // Indices of completed sub-lessons
  subLessonFeedback: Record<number, 'helpful' | 'unhelpful'>; // Feedback for sub-lessons
  pillars: LearningPillar[];
  paths: LessonPath[];
  chatHistory: ChatMessage[];
  
  isLoading: boolean;
  error: string | null;
}
