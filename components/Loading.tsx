import React from 'react';

interface LoadingProps {
  message: string;
}

const Loading: React.FC<LoadingProps> = ({ message }) => {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] w-full p-8 animate-fade-in">
      <div className="relative w-20 h-20 mb-6">
        <div className="absolute top-0 left-0 w-full h-full bg-primary/20 rounded-full animate-ping"></div>
        <div className="absolute top-0 left-0 w-full h-full bg-primary/40 rounded-full animate-pulse"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full"></div>
      </div>
      <h3 className="text-xl font-semibold text-gray-800 text-center">{message}</h3>
      <p className="text-gray-500 mt-2 text-center text-sm">Our AI Tutor is structuring your learning path...</p>
    </div>
  );
};

export default Loading;
