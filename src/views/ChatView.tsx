import { motion, AnimatePresence } from 'motion/react';
import { Send, Mic, CheckCircle2, Bot, User, Languages } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { extractIntent, isPlaceholder, i18nResponses } from '../lib/intent';
import { AppLanguage } from '../App';
import { getUserProfile } from '../lib/profile';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

interface IntentState {
  serviceType: string | null; // For backward compatibility with single-service contract
  serviceTypes: string[]; // New field for multi-service
  city: string | null;
  area: string | null;
  detectedLanguage: AppLanguage;
}

interface ChatViewProps {
  onServiceTriggered: (data: any) => void;
  appLanguage: AppLanguage;
}

export function ChatView({ onServiceTriggered, appLanguage }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: appLanguage === 'urdu' ? 'السلام علیکم! میں آپ کا خدمت گار اے آئی ہوں۔ میں آج آپ کی کیسے مدد کر سکتا ہوں؟' : 
            appLanguage === 'roman_urdu' ? 'Asalam-o-Alaikum! Main aap ka KhidmatGaar AI hoon. Main aaj aap ki kese madad kar sakta hoon?' :
            'Asalam-o-Alaikum! I am your KhidmatGaar AI. How can I help you today?',
      sender: 'ai',
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isAITyping, setIsAITyping] = useState(false);
  const [pendingService, setPendingService] = useState<string | null>(null);
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

  const lang = intent.detectedLanguage || 'english';
  const responses = i18nResponses[lang];

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAITyping]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Speech Recognition Setup
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputText(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
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

  const handleSendMessage = async (text?: string) => {
    const messageText = text || inputText;
    if (!messageText.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: messageText,
      sender: 'user',
      timestamp: new Date(),
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputText('');
    setIsAITyping(true);

    setTimeout(async () => {
      let aiResponseText = '';
      let shouldCallWebhook = false;
      let nextIntent = { ...intent };

      const extracted = extractIntent(messageText);
      const lang = extracted.detectedLanguage || intent.detectedLanguage;
      const responses = i18nResponses[lang];

      // Case 1: We are waiting for a confirmation of a service
      if (pendingService) {
        const lowerText = messageText.toLowerCase();
        const isYes = /\b(yes|ji|han|haan|confirm|correct|thik|theek|yep|yeah)\b/i.test(lowerText);
        const isNo = /\b(no|nahi|wrong|na|incorrect)\b/i.test(lowerText);

        if (isYes) {
          nextIntent.serviceType = pendingService;
          nextIntent.serviceTypes = [pendingService];
          setIntent(nextIntent);
          setPendingService(null);
          
          if (isPlaceholder(nextIntent.city)) {
            aiResponseText = responses.askCity;
          } else if (isPlaceholder(nextIntent.area)) {
            aiResponseText = responses.askArea(nextIntent.city!);
          } else {
            aiResponseText = responses.ready;
            shouldCallWebhook = true;
          }
        } else if (isNo) {
          setPendingService(null);
          aiResponseText = responses.askService; // Ask for service again
        } else {
          // User said something else, try to re-extract
          if (extracted.serviceTypes.length > 0 && !isPlaceholder(extracted.serviceTypes[0])) {
            setPendingService(extracted.serviceTypes[0]);
            aiResponseText = responses.confirmService(extracted.serviceTypes[0]);
          } else {
            aiResponseText = responses.confirmService(pendingService); // Re-ask for confirmation
          }
        }
      } 
      // Case 2: Normal flow
      else {
        // Update intent fields if they were extracted and aren't placeholders
        const updatedIntent: IntentState = {
          serviceType: (!isPlaceholder(extracted.serviceType) ? extracted.serviceType : null) || intent.serviceType,
          serviceTypes: extracted.serviceTypes.length > 0 && !isPlaceholder(extracted.serviceTypes[0]) ? extracted.serviceTypes : intent.serviceTypes,
          city: (!isPlaceholder(extracted.city) ? extracted.city : null) || intent.city,
          area: (!isPlaceholder(extracted.area) ? extracted.area : null) || intent.area,
          detectedLanguage: extracted.detectedLanguage || intent.detectedLanguage,
        };

        // If we just found a NEW service type, ask for confirmation
        if (intent.serviceTypes.length === 0 && updatedIntent.serviceTypes.length > 0 && !isPlaceholder(updatedIntent.serviceTypes[0])) {
          setPendingService(updatedIntent.serviceTypes[0]);
          aiResponseText = responses.confirmService(updatedIntent.serviceTypes[0]);
        } 
        else {
          setIntent(updatedIntent);
          nextIntent = updatedIntent;

          if (isPlaceholder(nextIntent.serviceType)) {
            aiResponseText = responses.askService;
          } else if (isPlaceholder(nextIntent.city)) {
            aiResponseText = responses.askCity;
          } else if (isPlaceholder(nextIntent.area)) {
            aiResponseText = responses.askArea(nextIntent.city!);
          } else {
            aiResponseText = responses.ready;
            shouldCallWebhook = true;
          }
        }
      }

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: aiResponseText,
        sender: 'ai',
        timestamp: new Date(),
      };

      const finalMessages = [...updatedMessages, aiMessage];
      setMessages(finalMessages);
      setIsAITyping(false);

      if (shouldCallWebhook) {
        await triggerWebhook(messageText, nextIntent, finalMessages);
      }
    }, 1000);
  };

  const triggerWebhook = async (originalInput: string, finalIntent: IntentState, allMessages: Message[]) => {
    setIsAITyping(true);
    
    // Compile all user messages for context
    const userMessages = allMessages
      .filter(m => m.sender === 'user')
      .map(m => m.text);
    
    // Ensure the focus is on the user messages only
    const compiledRawMessage = userMessages.join(' | ');

    try {
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'khadmat-intent',
          raw_message: compiledRawMessage,
          message: originalInput,
          last_message: originalInput,
          service_type: finalIntent.serviceType, // Still sending single for existing WF1 contract
          service_types: finalIntent.serviceTypes, // New field for multi-service
          city: finalIntent.city,
          area: finalIntent.area,
          detected_language: finalIntent.detectedLanguage,
          source: 'chat',
          user_email: getUserProfile()?.email || ''
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Webhook failed: ${response.status} ${errorText}`);
      }

      const resText = await response.text();
      console.log('Chat Webhook Raw Response:', resText);
      let data: any = {};
      if (resText) {
        try {
          let parsed = JSON.parse(resText);
          // Unpack single-item array from common webhook patterns (e.g. n8n)
          data = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
          console.log('Chat Webhook Parsed Data:', data);
        } catch (e) {
          data = { text: resText };
          console.log('Chat Webhook Fallback (Non-JSON):', data);
        }
      }

      // Check if backend is asking for clarification
      if (data && data.status === 'clarification_needed') {
        const aiMsg: Message = {
          id: (Date.now() + 3).toString(),
          text: data.clarification_question || responses.error,
          sender: 'ai',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, aiMsg]);
        setIsAITyping(false);
      } else {
        // Switch to matches view
        onServiceTriggered(data);
      }
    } catch (error) {
      console.error('Chat Webhook error:', error);
      const errorMsg: Message = {
        id: (Date.now() + 2).toString(),
        text: responses.error,
        sender: 'ai',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
      setIsAITyping(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-background">
      
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-32 bg-primary/5 -z-10 blur-3xl"></div>

      {/* Header Info */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-outline-variant/30 bg-white/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
            <Bot className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-on-surface">KhidmatGaar AI</h1>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>
              <span className="text-[10px] text-outline font-medium">Always Listening</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
           <div className={`px-2 py-1 rounded bg-surface-container-low border border-outline-variant/30 flex items-center gap-1.5 transition-all ${intent.detectedLanguage !== 'english' ? 'scale-105 border-primary/30' : ''}`}>
             <Languages className="w-3 h-3 text-primary" />
             <span className="text-[10px] font-bold text-on-surface-variant uppercase">{intent.detectedLanguage.replace('_', ' ')}</span>
           </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-grow overflow-y-auto px-4 py-6 space-y-6 flex flex-col no-scrollbar pb-32">
        {messages.map((msg) => (
          <motion.div 
            key={msg.id}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} w-full group`}
          >
            <div className={`flex items-end gap-2 max-w-[85%] ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mb-1 ${msg.sender === 'user' ? 'bg-secondary/10' : 'bg-primary/10'}`}>
                {msg.sender === 'user' ? <User className="w-3.5 h-3.5 text-secondary" /> : <Bot className="w-3.5 h-3.5 text-primary" />}
              </div>
              <div 
                className={`p-4 rounded-2xl shadow-sm border ${
                  msg.sender === 'user' 
                    ? 'bg-secondary text-white rounded-br-none border-secondary/20' 
                    : 'bg-white rounded-bl-none border-outline-variant/30 text-on-surface'
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                <p className={`text-[9px] mt-1 text-right opacity-60 ${msg.sender === 'user' ? 'text-white' : 'text-outline'}`}>
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
        
        {isAITyping && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex justify-start w-full"
          >
            <div className="flex items-center gap-2 bg-white/50 backdrop-blur-sm p-3 rounded-2xl border border-outline-variant/20">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div 
                    key={i}
                    animate={{ y: [0, -4, 0] }}
                    transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                    className="w-1.5 h-1.5 rounded-full bg-primary"
                  />
                ))}
              </div>
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest ml-1">Thinking</span>
            </div>
          </motion.div>
        )}

        {/* Intent Progress (Visual aid) */}
        {(intent.serviceTypes.length > 0 || intent.city || intent.area || pendingService) && !isAITyping && (
           <div className="bg-white/95 backdrop-blur-md p-3 rounded-xl border border-primary/20 shadow-lg mb-4 flex items-center justify-between mx-2 sticky bottom-0 z-10">
              <div className="flex gap-3">
                <div className={`text-[9px] font-bold px-2 py-1 rounded bg-surface-container-low border ${intent.serviceTypes.length > 0 ? 'border-secondary/30 text-secondary' : pendingService ? 'border-amber-500/30 text-amber-600 animate-pulse' : 'border-outline-variant/30 text-outline'}`}>
                  {intent.serviceTypes.length > 0 ? intent.serviceTypes.join(', ') : pendingService || 'SERVICE?'}
                </div>
                <div className={`text-[9px] font-bold px-2 py-1 rounded bg-surface-container-low border ${intent.city ? 'border-secondary/30 text-secondary' : 'border-outline-variant/30 text-outline'}`}>
                  {intent.city || 'CITY?'}
                </div>
                <div className={`text-[9px] font-bold px-2 py-1 rounded bg-surface-container-low border ${intent.area ? 'border-secondary/30 text-secondary' : 'border-outline-variant/30 text-outline'}`}>
                  {intent.area || 'AREA?'}
                </div>
              </div>
              {intent.serviceTypes.length > 0 && intent.city && intent.area && (
                <CheckCircle2 className="w-4 h-4 text-secondary" />
              )}
           </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Fixed Bottom Input Area */}
      <div className="absolute bottom-0 left-0 w-full p-4 bg-gradient-to-t from-background via-background/95 to-transparent pt-10">
        
        {/* Floating Listening UI */}
        <AnimatePresence>
          {isListening && (
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.8 }}
              className="absolute -top-16 left-0 w-full flex justify-center pointer-events-none"
            >
              <div className="bg-secondary text-white px-6 py-2.5 rounded-full shadow-2xl flex items-center gap-3 border border-white/20 backdrop-blur-md">
                <div className="flex gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <motion.div 
                      key={i}
                      animate={{ height: [8, 20, 8] }}
                      transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                      className="w-1 rounded-full bg-white"
                    />
                  ))}
                </div>
                <span className="text-xs font-bold uppercase tracking-widest">Listening...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2 max-w-4xl mx-auto">
          <div className="flex-grow glass-card rounded-2xl border border-outline-variant/40 shadow-xl p-1.5 flex items-center bg-white/95">
             <button 
              onClick={toggleListening}
              className={`p-3 rounded-xl transition-all ${isListening ? 'bg-secondary text-white scale-110 shadow-lg' : 'bg-surface-container-low text-outline hover:text-primary hover:bg-primary/5'}`}
            >
              <Mic className={`w-5 h-5 ${isListening ? 'animate-pulse' : ''}`} />
            </button>
            <input 
              type="text" 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder={isListening ? "Listening..." : responses.askService} 
              className="w-full bg-transparent border-none focus:ring-0 text-sm placeholder:text-on-surface-variant/50 px-2 outline-none font-medium"
            />
            <button 
              onClick={() => handleSendMessage()}
              disabled={!inputText.trim() || isAITyping}
              className="bg-primary text-white p-3 rounded-xl hover:opacity-90 active:scale-95 disabled:opacity-30 transition-all shadow-md flex items-center justify-center min-w-[48px]"
            >
              {isAITyping ? <div className="w-5 h-5 border-2 border-white border-t-transparent animate-spin rounded-full"></div> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


