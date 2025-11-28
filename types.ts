
export enum AppStep {
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
  content: string; // Brief description of what to do
  actionItem: string; // Practical task
}

export interface Curriculum {
  pathTitle: string;
  objectives: string[];
  keyConcepts: string[];
  subLessons: SubLesson[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isThinking?: boolean;
}

export interface AppState {
  step: AppStep;
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
