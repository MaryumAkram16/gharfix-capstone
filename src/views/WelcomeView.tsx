import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect } from 'react';

interface WelcomeSlide {
  id: number;
  title: string;
  description: string;
  image: string;
}

const welcomeSlides: WelcomeSlide[] = [
  {
    id: 1,
    title: 'Find trusted experts near you',
    description: 'Access a network of verified professionals for all your home maintenance needs.',
    image: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?q=80&w=2069&auto=format&fit=crop',
  },
  {
    id: 2,
    title: 'Instant booking & confirmation',
    description: 'Book services in seconds with real-time availability and instant confirmations.',
    image: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?q=80&w=2070&auto=format&fit=crop',
  },
  {
    id: 3,
    title: 'Track & rate your service',
    description: 'Live tracking, transparent pricing, and easy ratings to ensure quality service.',
    image: 'https://images.unsplash.com/photo-1526628953301-3e589a6a8b74?q=80&w=2006&auto=format&fit=crop',
  },
];

export function WelcomeView({ onGetStarted }: { onGetStarted: () => void }) {
  const [currentSlide, setCurrentSlide] = useState(0);

  // Auto-advance slides every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % welcomeSlides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const goToSlide = (index: number) => {
    setCurrentSlide(index);
  };

  const slide = welcomeSlides[currentSlide];

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 relative">
      {/* Main Content Container */}
      <div className="flex-1 flex flex-col items-center justify-center w-full px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 text-center"
        >
          <h1 className="text-3xl font-bold text-blue-900 mb-2">KhidmatGaar</h1>
          <p className="text-sm text-gray-600 font-medium">
            Aapki Zaroorat, Hamare Maahir
          </p>
          <p className="text-xs text-gray-500 mt-1">
            اپنی ضرورت، ہمارے ماہر
          </p>
        </motion.div>

        {/* Carousel Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="w-full max-w-sm"
        >
          <div className="bg-white rounded-3xl shadow-lg overflow-hidden border border-gray-100">
            {/* Carousel Image */}
            <div className="w-full h-56 bg-gray-200 relative overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.img
                  key={slide.id}
                  src={slide.image}
                  alt={slide.title}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                  className="w-full h-full object-cover"
                />
              </AnimatePresence>
            </div>

            {/* Slide Content */}
            <div className="p-6 text-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={slide.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                >
                  <h2 className="text-xl font-bold text-gray-900 mb-2">{slide.title}</h2>
                  <p className="text-sm text-gray-600 leading-relaxed">{slide.description}</p>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* Pagination Dots */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex gap-2 mt-8"
        >
          {welcomeSlides.map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              className={`transition-all duration-300 rounded-full ${
                index === currentSlide
                  ? 'w-2 h-2 bg-blue-900'
                  : 'w-2 h-2 bg-gray-300 hover:bg-gray-400'
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </motion.div>
      </div>

      {/* Bottom Section with Buttons */}
      <div className="w-full bg-gradient-to-t from-blue-900 to-blue-800 text-white">
        {/* Get Started Button - Full Width */}
        <button
          onClick={onGetStarted}
          className="w-full py-4 bg-blue-900 hover:bg-blue-950 text-white font-bold text-lg transition-colors flex items-center justify-center gap-2"
        >
          Get Started
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}