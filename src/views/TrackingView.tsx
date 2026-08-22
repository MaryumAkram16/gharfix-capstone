import { motion } from 'motion/react';
import { Car, Phone, MessageSquare, Star, Check, Navigation2, Wrench } from 'lucide-react';

export function TrackingView() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      
      {/* Map Area */}
      <section className="relative w-full h-[320px] rounded-[2rem] overflow-hidden shadow-lg border border-outline-variant/30 bg-surface-variant flex items-center justify-center">
        <img 
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuCsJUz-tIXoS0u_YZcLqoD1zpDB4OR3xxHrd3vLPtC99ocXwUugnKr0Wn8MogjW6A02_6Iuvg17k_0ba0_EIFvXrmU5u0ovQask8qQQJ9Uan5mge8PtukggZ6sfQ0ZzMINWQClM1YqMvRptula-VmSXlperSGCQY1TubAq7cwHX_eemI8Nl04-JuGS7Bqr5Cc16dOgBlI-1kph6i8V7gFibcfkxmpCOZm9zgqVIiOgdMmpCaV70MQPdVqAjUbFFB7W4bzDX1HXjLNM"
            alt="Map"
            className="w-full h-full object-cover"
        />
        
        {/* ETA Overlay */}
        <div className="absolute top-4 left-4 glass-card px-4 py-3 rounded-2xl shadow-md flex items-center gap-3 backdrop-blur-xl border-white/40">
          <div className="bg-primary text-white w-10 h-10 rounded-full flex items-center justify-center shadow-inner mt-0.5">
            <Car className="w-5 h-5 fill-current" />
          </div>
          <div>
            <p className="text-[9px] uppercase font-bold text-on-surface-variant tracking-wider">Arrival In</p>
            <p className="text-xl font-black text-primary leading-none mt-0.5">12 Min</p>
          </div>
        </div>

        {/* Provider Profile Floating */}
        <div className="absolute bottom-4 left-4 right-4 glass-card p-3 rounded-2xl shadow-lg flex items-center justify-between border-white/60 bg-white/80">
          <div className="flex items-center gap-3">
            <img 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDl0jH7yJH-iHYzG0UxLGLYLaS81cQfiEuKtL6KXETPIQj0XXB0wcKvqpk0EwgllbRylQlUv3w9reRrf5FCMXbQsOATh9TQwEbjRDmFvRObF4uGbOnWB_Irlh_kDSju6cyuqlofVjAcyAgSHHCNazjXbODb-JSPby1Yll14oMkIzsMbVerVZbGQJ3i2PZImfjyz4gZb_7BXgbnssxOmY0073APUErpm8HJN7Hwa6tCzRcKzy5jan2d9AtLvlZO0Q7ZDgfcVUBNASfA"
              alt="Provider"
              className="w-12 h-12 rounded-xl object-cover border-2 border-secondary"
            />
            <div>
              <h3 className="text-sm font-bold text-primary">Zahid Khan</h3>
              <div className="flex items-center gap-1 text-secondary mt-0.5">
                <Star className="w-3.5 h-3.5 fill-current" />
                <span className="text-[10px] font-bold">4.9 Pro</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="w-10 h-10 rounded-full bg-secondary-container/50 text-secondary flex items-center justify-center hover:bg-secondary-container active:scale-95 transition-all">
              <Phone className="w-4 h-4 fill-current" />
            </button>
            <button className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 active:scale-95 transition-all">
              <MessageSquare className="w-4 h-4 fill-current" />
            </button>
          </div>
        </div>
      </section>

      {/* Real-time Status Card */}
      <section className="glass-card p-5 rounded-[2rem] shadow-sm border-l-[5px] border-l-secondary bg-white/70">
        <h3 className="text-sm font-extrabold text-primary mb-5 flex items-center gap-2">
          <Navigation2 className="w-4 h-4 text-secondary fill-secondary" />
          Live Updates
        </h3>
        
        <div className="space-y-6 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-outline-variant/40">
          
          <div className="relative pl-8">
            <div className="absolute left-0 top-0.5 w-6 h-6 rounded-full bg-secondary text-white flex items-center justify-center ring-4 ring-white shadow-sm">
              <Wrench className="w-3 h-3 font-bold" />
            </div>
            <p className="text-[10px] font-bold text-secondary uppercase tracking-widest leading-none">14:45 • Now</p>
            <p className="text-sm font-bold text-on-surface mt-1">Service started at location</p>
          </div>

          <div className="relative pl-8 opacity-75">
            <div className="absolute left-0 top-0.5 w-6 h-6 rounded-full bg-surface-variant flex items-center justify-center ring-4 ring-white">
              <Check className="w-3.5 h-3.5 text-on-surface-variant" />
            </div>
            <p className="text-[10px] font-semibold text-outline leading-none">14:40</p>
            <p className="text-sm font-medium text-on-surface-variant mt-1.5 leading-tight">Zahid reached your residence</p>
          </div>

        </div>
      </section>

      {/* Service Checklist */}
      <section className="glass-card p-5 rounded-[2rem] shadow-sm border border-white/60 bg-white/60">
        <h3 className="text-sm font-bold text-primary mb-4">Mandatory Checklist</h3>
        <ul className="space-y-3">
          <li className="flex items-center gap-3">
            <div className="w-5 h-5 rounded flex items-center justify-center bg-secondary text-white">
              <Check className="w-3.5 h-3.5" />
            </div>
            <span className="text-sm text-on-surface-variant line-through font-medium opacity-70">Materials Verified</span>
          </li>
          <li className="flex items-center gap-3">
             <div className="w-5 h-5 rounded-full border-2 border-secondary flex items-center justify-center">
                <div className="w-2.5 h-2.5 bg-secondary rounded-full animate-pulse"></div>
             </div>
            <span className="text-sm font-bold text-primary">Service in Progress</span>
          </li>
          <li className="flex items-center gap-3 opacity-40">
            <div className="w-5 h-5 rounded border-2 border-outline"></div>
            <span className="text-sm font-medium">Final Quality Check</span>
          </li>
        </ul>
      </section>

      <div className="h-10"></div>
    </motion.div>
  );
}
