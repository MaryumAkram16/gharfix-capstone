import { motion, AnimatePresence } from 'motion/react';
import { Search, Mic, Plug, Wrench, Wind, Car, Brush, Clock, Bot, Send, CheckCircle2, Sparkles, Hammer, Paintbrush, Refrigerator, Smartphone, Bug, ChefHat, Tv, ShowerHead, Wifi, Sun, Heart } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { extractIntent, isPlaceholder, i18nResponses } from '../lib/intent';
import { AppLanguage } from '../App';
import { getUserProfile } from '../lib/profile';

interface HomeViewProps {
  onServiceTriggered: (data: any) => void;
  appLanguage: AppLanguage;
}

interface IntentState {
  serviceType: string | null;
  serviceTypes: string[];
  city: string | null;
  area: string | null;
  detectedLanguage: AppLanguage;
}

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
}

export function HomeView({ onServiceTriggered, appLanguage }: HomeViewProps) {
  const [requestText, setRequestText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isAITyping, setIsAITyping] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [intent, setIntent] = useState<IntentState>({
    serviceType: null,
    serviceTypes: [],
    city: null,
    area: null,
    detectedLanguage: appLanguage,
  });

  useEffect(() => {
    setIntent(prev => ({ ...prev, detectedLanguage: appLanguage }));
  }, [appLanguage]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAITyping]);

  // Handle Speech Recognition Setup
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setPendingTranscript(transcript);
        setIsListening(false);
        
        const aiMsg: ChatMessage = { 
          id: (Date.now() + 5).toString(), 
          text: `I heard: "${transcript}"\n\nIs this correct?`, 
          sender: 'ai' 
        };
        setMessages(prev => [...prev, aiMsg]);
      };

      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const confirmTranscript = () => {
    if (pendingTranscript) {
      handleServiceRequest(pendingTranscript);
      setPendingTranscript(null);
    }
  };

  const rejectTranscript = () => {
    setPendingTranscript(null);
    const lang = (intent.detectedLanguage as keyof typeof i18nResponses) || 'english';
    const aiMsg: ChatMessage = { 
      id: (Date.now() + 6).toString(), 
      text: lang === 'urdu' ? "کوئی مسئلہ نہیں! براہ کرم دوبارہ بولیں یا اپنی درخواست ٹائپ کریں۔" : 
            lang === 'roman_urdu' ? "Koi masla nahi! Please dobara bolen ya type karein." :
            "No problem! Please try speaking again or type your request.", 
      sender: 'ai' 
    };
    setMessages(prev => [...prev, aiMsg]);
  };

  const handleServiceRequest = async (overrideText?: string) => {
    let text = overrideText || requestText;
    console.log('handleServiceRequest called with text:', text);
    
    if (!text.trim() && intent.serviceType) {
      text = `Find matches for ${intent.serviceType}${intent.city ? ` in ${intent.city}` : ''}${intent.area ? ` (${intent.area})` : ''}`;
      console.log('Synthesized text:', text);
    }

    if (!text.trim()) {
      console.log('Empty text, ignoring request');
      return;
    }

    const newUserMsg: ChatMessage = { id: Date.now().toString(), text, sender: 'user' };
    const updatedMessages = [...messages, newUserMsg];
    setMessages(updatedMessages);
    setRequestText('');

    const extracted = extractIntent(text);
    
    const updatedIntent = {
      serviceType: !isPlaceholder(extracted.serviceType) ? extracted.serviceType : intent.serviceType,
      serviceTypes: extracted.serviceTypes && extracted.serviceTypes.length > 0 && !isPlaceholder(extracted.serviceTypes[0]) ? extracted.serviceTypes : intent.serviceTypes,
      city: !isPlaceholder(extracted.city) ? extracted.city : intent.city,
      area: !isPlaceholder(extracted.area) ? extracted.area : intent.area,
      detectedLanguage: extracted.detectedLanguage || intent.detectedLanguage,
    };
    
    setIntent(updatedIntent);
    setIsAITyping(true);

    setTimeout(async () => {
      let aiResponseText = '';
      let isComplete = false;
      
      const lang = (updatedIntent.detectedLanguage as keyof typeof i18nResponses) || 'english';
      const responses = i18nResponses[lang];

      if (isPlaceholder(updatedIntent.serviceType) || updatedIntent.serviceTypes.length === 0) {
        aiResponseText = responses.askService;
      } else if (isPlaceholder(updatedIntent.city)) {
        aiResponseText = responses.askCity;
      } else if (isPlaceholder(updatedIntent.area)) {
        aiResponseText = responses.askArea(updatedIntent.city!);
      } else {
        aiResponseText = responses.ready;
        isComplete = true;
      }

      const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), text: aiResponseText, sender: 'ai' };
      setMessages(prev => [...prev, aiMsg]);
      setIsAITyping(false);

      if (isComplete) {
        await triggerWebhook(text, updatedIntent, updatedMessages);
      }
    }, 1000);
  };

  const triggerWebhook = async (originalInput: string, finalIntent: IntentState, allMessages: ChatMessage[]) => {
    setIsLoading(true);
    setHasError(false);

    const userMessages = allMessages
      .filter(m => m.sender === 'user')
      .map(m => m.text);
    
    const compiledRawMessage = userMessages.join(' | ');

    console.log('Triggering Webhook with:', { compiledRawMessage, finalIntent });
    try {
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'khadmat-intent',
          raw_message: compiledRawMessage,
          message: originalInput,
          last_message: originalInput,
          service_type: finalIntent.serviceType,
          service_types: finalIntent.serviceTypes,
          city: finalIntent.city,
          area: finalIntent.area,
          detected_language: finalIntent.detectedLanguage,
          source: 'home',
          user_email: getUserProfile()?.email || ''
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      const resText = await response.text();
      console.log('Webhook Raw Response:', resText);
      let data: any = {};
      if (resText) {
        try {
          let parsed = JSON.parse(resText);
          data = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
          console.log('Webhook Parsed Data:', data);
        } catch (e) {
          data = { text: resText };
          console.log('Webhook Fallback (Non-JSON):', data);
        }
      }

      if (data && data.status === 'clarification_needed') {
        const lang = (finalIntent.detectedLanguage as keyof typeof i18nResponses) || 'english';
        const responses = i18nResponses[lang];
        const clarificationMsg: ChatMessage = {
          id: (Date.now() + 3).toString(),
          text: data.clarification_question || responses.error,
          sender: 'ai'
        };
        setMessages(prev => [...prev, clarificationMsg]);
      } else {
        onServiceTriggered(data);
      }
    } catch (error) {
      console.error('Webhook Error Details:', error);
      setHasError(true);
      const lang = (finalIntent.detectedLanguage as keyof typeof i18nResponses) || 'english';
      const responses = i18nResponses[lang];
      const errorMsg: ChatMessage = { 
        id: (Date.now() + 2).toString(), 
        text: responses.error, 
        sender: 'ai' 
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const categories = [
    { icon: Plug,          label: 'Electrician',       urdu: 'الیکٹریشن',   color: 'bg-primary/10 text-primary' },
    { icon: Wrench,       label: 'Plumber',            urdu: 'پلمبر',        color: 'bg-secondary/10 text-secondary' },
    { icon: Wind,         label: 'AC Repair',          urdu: 'اے سی مرمت',  color: 'bg-tertiary-container/10 text-tertiary' },
    { icon: Hammer,       label: 'Carpenter',          urdu: 'بڑھئی',        color: 'bg-primary/10 text-primary' },
    { icon: Paintbrush,   label: 'Painter',            urdu: 'پینٹر',        color: 'bg-secondary/10 text-secondary' },
    { icon: Refrigerator, label: 'Fridge Repair',      urdu: 'فریج مرمت',   color: 'bg-tertiary-container/10 text-tertiary' },
    { icon: Smartphone,   label: 'Phone Repair',       urdu: 'موبائل مرمت', color: 'bg-on-surface-variant/10 text-on-surface-variant' },
    { icon: Bug,          label: 'Pest Control',       urdu: 'کیڑے مار',    color: 'bg-primary/10 text-primary' },
    { icon: ChefHat,      label: 'Cook',               urdu: 'باورچی',       color: 'bg-secondary/10 text-secondary' },
    { icon: Heart,        label: 'Nurse',              urdu: 'نرس',          color: 'bg-tertiary-container/10 text-tertiary' },
    { icon: Car,          label: 'Car Mechanic',       urdu: 'گاڑی مستری',  color: 'bg-on-surface-variant/10 text-on-surface-variant' },
    { icon: Sun,          label: 'Solar Installation', urdu: 'سولر پینل',   color: 'bg-primary/10 text-primary' },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-10"
    >
      {/* AI Assistant Section */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2 px-1">
          <Bot className="w-5 h-5 text-primary" />
          <h2 className="text-sm font-bold text-on-surface flex items-center gap-2">
            KhidmatGaar Assistant
            <span className="text-[10px] bg-secondary/10 text-secondary px-1.5 py-0.5 rounded uppercase tracking-wider font-extrabold animate-pulse">Live</span>
          </h2>
        </div>

        <div className="glass-card rounded-[2rem] border border-outline-variant/30 overflow-hidden shadow-lg bg-white/60 backdrop-blur-md">
          {/* Conversational Area */}
          <div className="max-h-[300px] overflow-y-auto px-5 py-6 space-y-4 no-scrollbar">
            {messages.length === 0 ? (
              <div className="text-center py-4 space-y-2">
                <p className="text-sm text-on-surface-variant/70 italic">"Asalam-o-Alaikum! Tell me what service you need today."</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {['AC Repair Lahore', 'Plumber DHA', 'Electrician chahiye'].map((hint, i) => (
                    <button key={i} onClick={() => handleServiceRequest(hint)} className="text-[10px] font-bold text-primary bg-primary/5 px-3 py-1.5 rounded-full border border-primary/10 hover:bg-primary/10 transition-colors">
                      {hint}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <motion.div 
                  key={msg.id} 
                  initial={{ opacity: 0, x: msg.sender === 'user' ? 10 : -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm ${
                    msg.sender === 'user' 
                      ? 'bg-secondary text-white rounded-tr-none' 
                      : 'bg-surface-container-low text-on-surface border border-outline-variant/30 rounded-tl-none'
                  }`}>
                    {msg.text}
                  </div>
                </motion.div>
              ))
            )}
            {isAITyping && (
              <div className="flex justify-start">
                <div className="bg-surface-container-low px-4 py-3 rounded-2xl rounded-tl-none border border-outline-variant/30 flex gap-1">
                  <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-primary" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Intent Progress (Visual aid) */}
          {(intent.serviceTypes.length > 0 || intent.city || intent.area) && !isAITyping && (
            <div className="bg-white/95 backdrop-blur-md p-3 rounded-xl border border-primary/20 shadow-lg mb-4 flex items-center justify-between mx-4 sticky bottom-0 z-10">
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                <div className={`text-[9px] font-bold px-2 py-1 rounded bg-surface-container-low border whitespace-nowrap ${intent.serviceTypes.length > 0 ? 'border-secondary/30 text-secondary' : 'border-outline-variant/30 text-outline'}`}>
                  {intent.serviceTypes.length > 0 ? intent.serviceTypes.join(', ') : 'SERVICE?'}
                </div>
                <div className={`text-[9px] font-bold px-2 py-1 rounded bg-surface-container-low border whitespace-nowrap ${intent.city ? 'border-secondary/30 text-secondary' : 'border-outline-variant/30 text-outline'}`}>
                  {intent.city || 'CITY?'}
                </div>
                <div className={`text-[9px] font-bold px-2 py-1 rounded bg-surface-container-low border whitespace-nowrap ${intent.area ? 'border-secondary/30 text-secondary' : 'border-outline-variant/30 text-outline'}`}>
                  {intent.area || 'AREA?'}
                </div>
              </div>
              {intent.serviceTypes.length > 0 && intent.city && intent.area && (
                <CheckCircle2 className="w-4 h-4 text-secondary shrink-0 ml-2" />
              )}
            </div>
          )}

          {/* Input Area */}
          <div className="p-3 bg-white/40 border-t border-outline-variant/20">
            {pendingTranscript ? (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <button 
                    onClick={confirmTranscript}
                    className="flex-1 bg-primary text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    Yes, Correct
                  </button>
                  <button 
                    onClick={rejectTranscript}
                    className="flex-1 bg-surface-container text-on-surface py-3 rounded-xl font-bold border border-outline-variant/30 flex items-center justify-center gap-2 active:scale-95 transition-all"
                  >
                    <Clock className="w-5 h-5" />
                    No, Retry
                  </button>
                </div>
                <p className="text-[10px] text-center text-on-surface-variant/60 font-medium italic">Click "Yes" to find matches for your request</p>
              </div>
            ) : (
              <div className={`relative flex items-center bg-white rounded-2xl p-1 shadow-sm border ${isListening ? 'border-secondary ring-2 ring-secondary/20' : 'border-outline-variant/50 focus-within:ring-2 focus-within:ring-primary/20'} transition-all`}>
                <button 
                  onClick={toggleListening}
                  className={`p-3 rounded-xl transition-all ${isListening ? 'bg-secondary text-white animate-pulse' : 'text-on-surface-variant hover:bg-surface-container'}`}
                  title="Voice Input"
                >
                  <Mic className="w-5 h-5" />
                </button>
                <input 
                  type="text" 
                  value={requestText}
                  onChange={(e) => setRequestText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleServiceRequest()}
                  placeholder={isListening ? "Listening..." : "AC repair in Johar Town?"} 
                  className="w-full bg-transparent border-none focus:ring-0 text-sm placeholder:text-on-surface-variant/50 px-2 outline-none font-medium"
                />
                <button 
                  onClick={() => handleServiceRequest()}
                  disabled={!requestText.trim() || isLoading}
                  className="bg-primary text-white p-3 rounded-xl hover:opacity-90 active:scale-95 disabled:opacity-30 transition-all shadow-md flex items-center justify-center min-w-[48px]"
                  title="Send Message"
                >
                  {isLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent animate-spin rounded-full"></div> : <Send className="w-5 h-5" />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Intent Progress Indicator */}
        <AnimatePresence>
          {(intent.serviceType || intent.city || intent.area) && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex gap-2 overflow-x-auto no-scrollbar pt-1"
            >
              {[
                { label: intent.serviceType, icon: Sparkles, color: 'text-primary', active: !isPlaceholder(intent.serviceType) },
                { label: intent.city, icon: Search, color: 'text-secondary', active: !isPlaceholder(intent.city) },
                { label: intent.area, icon: Wrench, color: 'text-tertiary', active: !isPlaceholder(intent.area) }
              ].map((item, i) => item.label && (
                <div key={i} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-sm shrink-0 border transition-all ${item.active ? 'bg-white border-outline-variant/30' : 'bg-surface-container/50 border-outline-variant/10 opacity-60'}`}>
                  <item.icon className={`w-3 h-3 ${item.active ? item.color : 'text-on-surface-variant/40'}`} />
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${item.active ? 'text-on-surface-variant' : 'text-on-surface-variant/40'}`}>{item.label}</span>
                  {item.active && <CheckCircle2 className="w-3 h-3 text-secondary" />}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Categories Grid */}
      <section>
        <div className="flex justify-between items-end mb-4 px-1">
          <h2 className="text-xl font-bold text-primary flex items-center gap-2">
            Services <span className="text-sm font-normal text-on-surface-variant/60 font-urdu">خدمات</span>
          </h2>
          <button className="text-secondary text-xs font-bold hover:underline">View All</button>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-6">
          {categories.map((cat, idx) => (
            <button 
              key={idx} 
              onClick={() => handleServiceRequest(cat.label)} 
              className="glass-card rounded-2xl flex flex-col items-center justify-center gap-2 py-4 hover:bg-surface transition-colors active:scale-95 group border-white/50"
            >
              <div className={`w-11 h-11 rounded-full ${cat.color} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <cat.icon className="w-5 h-5" />
              </div>
              <div className="text-center">
                <p className="text-xs font-bold text-on-surface">{cat.label}</p>
                <p className="text-[9px] text-on-surface-variant/70 mt-0.5">{cat.urdu}</p>
              </div>
            </button>
          ))}
        </div>
      </section>
    </motion.div>
  );
}