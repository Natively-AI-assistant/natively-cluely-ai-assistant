import React, { useState, useEffect, useRef } from 'react';
import { X, Mail, RotateCcw, ExternalLink, Loader2, Paperclip } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useT } from '../i18n';

interface Meeting {
    id: string;
    title: string;
    date: string;
    summary?: string;
    detailedSummary?: {
        overview?: string;
        actionItems: string[];
        keyPoints: string[];
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    calendarEventId?: string;
}

interface FollowUpEmailModalProps {
    isOpen: boolean;
    onClose: () => void;
    meeting: Meeting;
}

const FollowUpEmailModal: React.FC<FollowUpEmailModalProps> = ({ isOpen, onClose, meeting }) => {
    const t = useT();
    const [recipientEmail, setRecipientEmail] = useState('');
    const [senderName, setSenderName] = useState('');
    const [recipientName, setRecipientName] = useState('');

    // Subject & Body
    const [subject, setSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');

    // State
    const [isGenerating, setIsGenerating] = useState(false);
    const [hasGeneratedOnce, setHasGeneratedOnce] = useState(false);

    // Mount effect - Initialize and Generate
    useEffect(() => {
        if (isOpen) {
            initializeFields();
        }
    }, [isOpen, meeting]);

    const initializeFields = async () => {
        // 1. Set Subject
        const cleanTitle = meeting.title.replace(/["\*]/g, '').trim();
        setSubject(`Follow up - ${cleanTitle}`); // Default subject

        // 2. Load Sender Name
        const storedName = localStorage.getItem('natively_user_name');
        if (storedName) setSenderName(storedName);

        // 3. Load Recipient (Async)
        let loadedRecipientEmail = '';
        let loadedRecipientName = '';

        try {
            // Try Calendar
            if (meeting.calendarEventId) {
                // @ts-ignore
                const attendees = await window.electronAPI?.invoke('get-calendar-attendees', meeting.calendarEventId);
                if (attendees && attendees.length > 0) {
                    loadedRecipientEmail = attendees[0].email;
                    if (attendees[0].name) loadedRecipientName = attendees[0].name.split(' ')[0];
                }
            }

            // Fallback: Transcript
            if (!loadedRecipientEmail && meeting.transcript) {
                // @ts-ignore
                const extracted = await window.electronAPI?.invoke('extract-emails-from-transcript', meeting.transcript);
                if (extracted && extracted.length > 0) {
                    loadedRecipientEmail = extracted[0];
                }
            }
        } catch (e) {
            console.error(e);
        }

        if (loadedRecipientEmail) setRecipientEmail(loadedRecipientEmail);
        if (loadedRecipientName) setRecipientName(loadedRecipientName);

        // 4. Generate Content automatically if not done
        if (!emailBody && !isGenerating) {
            generateEmail(loadedRecipientName, storedName || '');
        }
    };

    const generateEmail = async (rName?: string, sName?: string) => {
        setIsGenerating(true);
        try {
            const input = {
                meeting_type: 'meeting' as const,
                title: meeting.title,
                summary: meeting.detailedSummary?.overview || meeting.summary,
                action_items: meeting.detailedSummary?.actionItems || [],
                key_points: meeting.detailedSummary?.keyPoints || [],
                recipient_name: rName || recipientName,
                sender_name: sName || senderName,
                tone: 'neutral' as const // Default to neutral for auto-gen
            };

            // @ts-ignore
            const generatedBody = await window.electronAPI?.invoke('generate-followup-email', input);
            if (generatedBody) {
                setEmailBody(generatedBody);
            }
        } catch (error) {
            console.error('Failed to generate email:', error);
            // NOTE: Do NOT use t() here. This is the recipient-facing email body
            // content, not the UI. The recipient's language isn't determined by
            // the user's UI locale. Keep this English (or surface a per-recipient
            // language signal if/when one exists).
            setEmailBody('Hi there,\n\nI enjoyed our conversation. Let me know if you have any questions.\n\nBest,');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleReset = () => {
        generateEmail();
    };

    const handleSendGmail = async () => {
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipientEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
        // @ts-ignore
        await window.electronAPI?.invoke('open-external', gmailUrl);
        onClose();
    };

    const handleSendDefault = async () => {
        // @ts-ignore
        await window.electronAPI?.invoke('open-mailto', {
            to: recipientEmail,
            subject: subject,
            body: emailBody
        });
        onClose();
    };


    if (!isOpen) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 transition-opacity"
                    />

                    {/* Modal Container */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ duration: 0.3, type: "spring", damping: 25, stiffness: 300 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
                    >
                        {/* The Window */}
                        <div className="w-full max-w-[640px] bg-[#121212]/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/[0.08] flex flex-col pointer-events-auto overflow-hidden ring-1 ring-white/5">

                            {/* Header / Top Bar */}
                            <div className="flex px-6 py-4 justify-between items-center border-b border-white/[0.06]">
                                <h2 className="text-sm font-medium text-[#E9E9E9] tracking-wide">{t('Draft Follow-up')}</h2>
                                <button onClick={onClose} className="text-[#71717A] hover:text-white transition-colors bg-white/5 hover:bg-white/10 p-1.5 rounded-full">
                                    <X size={14} />
                                </button>
                            </div>

                            {/* Inputs Area */}
                            <div className="px-8 pt-6 space-y-5">

                                {/* TO Field */}
                                <div className="flex items-start gap-6 group">
                                    <label className="text-[#71717A] text-[13px] w-[50px] font-medium pt-2">{t('To')}</label>
                                    <div className="flex-1 min-h-[32px] flex items-center border-b border-white/[0.06] group-focus-within:border-white/20 transition-colors pb-1">
                                        {recipientEmail ? (
                                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#27272A] border border-white/10 rounded-full text-[#E9E9E9] text-[13px] shadow-sm animate-in fade-in zoom-in duration-200">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></span>
                                                {recipientEmail}
                                                <button
                                                    onClick={() => setRecipientEmail('')}
                                                    className="hover:text-white text-[#71717A] transition-colors ml-1"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ) : (
                                            <input
                                                type="email"
                                                value={recipientEmail}
                                                onChange={(e) => setRecipientEmail(e.target.value)}
                                                placeholder={t("Recipient email")}
                                                className="w-full bg-transparent text-[#E9E9E9] placeholder-[#525255] focus:outline-none text-[14px]"
                                                autoFocus
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* SUBJECT Field */}
                                <div className="flex items-center gap-6 group">
                                    <label className="text-[#71717A] text-[13px] w-[50px] font-medium">{t('Subject')}</label>
                                    <div className="flex-1 border-b border-white/[0.06] group-focus-within:border-white/20 transition-colors pb-1">
                                        <input
                                            type="text"
                                            value={subject}
                                            onChange={(e) => setSubject(e.target.value)}
                                            className="w-full bg-transparent text-[#E9E9E9] focus:outline-none text-[14px] font-medium placeholder-[#525255]"
                                            placeholder={t("Subject line")}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Body Area */}
                            <div className="flex-1 px-8 py-6 min-h-[320px] relative">
                                {isGenerating ? (
                                    <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#121212]/50 backdrop-blur-[2px]">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="relative">
                                                <div className="w-10 h-10 border-2 border-[#27272A] border-t-blue-500 rounded-full animate-spin"></div>
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                                </div>
                                            </div>
                                            <span className="text-xs font-medium text-[#71717A] animate-pulse">{t('Drafting perfect follow-up...')}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <textarea
                                        value={emailBody}
                                        onChange={(e) => setEmailBody(e.target.value)}
                                        className="w-full h-full bg-transparent text-[#D4D4D8] text-[15px] leading-7 focus:outline-none resize-none placeholder-[#3F3F46] font-normal"
                                        placeholder={t("Write your email...")}
                                        spellCheck={false}
                                    />
                                )}
                            </div>

                            {/* Footer */}
                            <div className="flex items-center justify-between px-6 py-5 bg-[#18181B]/50 border-t border-white/[0.06]">
                                <div className="flex items-center gap-3">
                                    {/* Send with Gmail */}
                                    <button
                                        onClick={handleSendGmail}
                                        className="flex items-center gap-2 px-5 py-2.5 bg-[#202124] hover:bg-[#303134] rounded-full border border-[#5F6368] transition-colors group"
                                    >
                                        <div className="w-4 h-4 relative flex items-center justify-center">
                                            <span className="font-bold text-lg leading-none bg-clip-text text-transparent bg-gradient-to-r from-blue-500 via-red-500 to-yellow-500">G</span>
                                        </div>
                                        <span className="text-[#E8EAED] text-[13px] font-medium tracking-wide">Gmail</span>
                                    </button>
                                </div>

                                {/* Right Side Actions */}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleReset}
                                        disabled={isGenerating}
                                        className="flex items-center gap-2 px-4 py-2.5 hover:bg-white/5 rounded-xl transition-colors text-[#71717A] hover:text-[#E9E9E9] disabled:opacity-30 disabled:cursor-not-allowed group"
                                        title={t("Regenerate")}
                                    >
                                        <RotateCcw size={15} className={`group-hover:rotate-180 transition-transform duration-500 ${isGenerating ? 'animate-spin' : ''}`} />
                                        <span className="text-[13px] font-medium">{t('Reset')}</span>
                                    </button>
                                </div>
                            </div>

                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

export default FollowUpEmailModal;
