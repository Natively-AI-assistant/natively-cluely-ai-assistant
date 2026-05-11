import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle, FolderOpen, RefreshCw, Sparkles } from 'lucide-react';
import type { SkillSummary } from '../../types/electron';

export const SkillsSettings: React.FC = () => {
    const [skills, setSkills] = useState<SkillSummary[]>([]);
    const [skillsPath, setSkillsPath] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<string | null>(null);

    const loadSkills = useCallback(async () => {
        setLoading(true);
        try {
            const list = await window.electronAPI?.skillsRefresh?.();
            setSkills(Array.isArray(list) ? list : []);
            setStatus(null);
        } catch (error: any) {
            setStatus(error?.message || 'Could not load skills.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSkills();
    }, [loadSkills]);

    const openFolder = async () => {
        try {
            const result = await window.electronAPI?.skillsOpenFolder?.();
            if (result?.path) setSkillsPath(result.path);
            if (!result?.success && result?.error) setStatus(result.error);
        } catch (error: any) {
            setStatus(error?.message || 'Could not open skills folder.');
        }
    };

    return (
        <div className="space-y-5 animated fadeIn select-text pb-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-text-primary mb-1">Skills</h3>
                    <p className="text-xs text-text-secondary">
                        Local SKILL.md instructions that can be invoked from the overlay dropdown or by typing $skill-name or /skill-name.
                    </p>
                </div>
                <button
                    onClick={loadSkills}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle transition-all duration-200 text-xs font-medium text-text-secondary hover:text-text-primary active:scale-95 mt-1 disabled:opacity-60"
                >
                    <RefreshCw size={13} strokeWidth={2.5} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            <div className="bg-bg-card rounded-xl border border-border-subtle p-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <FolderOpen size={15} className="text-text-secondary" />
                            <h4 className="text-sm font-semibold text-text-primary">Skills Folder</h4>
                        </div>
                        <p className="text-xs text-text-secondary">
                            Add a folder containing a SKILL.md file here. Scripts and assets are ignored in this v1.
                        </p>
                        {skillsPath && (
                            <p className="mt-2 text-[11px] text-text-tertiary font-mono truncate">{skillsPath}</p>
                        )}
                    </div>
                    <button
                        onClick={openFolder}
                        className="px-4 py-2 rounded-lg bg-bg-input hover:bg-bg-elevated border border-border-subtle text-xs font-medium text-text-primary transition-colors shrink-0"
                    >
                        Open Folder
                    </button>
                </div>
            </div>

            {status && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    {status}
                </div>
            )}

            <div className="space-y-2">
                {skills.map((skill) => (
                    <div key={skill.id} className="bg-bg-card rounded-xl border border-border-subtle p-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex items-start gap-3">
                                <div className="w-8 h-8 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center shrink-0">
                                    <Sparkles size={15} className="text-accent-primary" />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="text-sm font-semibold text-text-primary truncate">{skill.name}</h4>
                                        <span className="px-1.5 py-0.5 rounded-md border border-border-subtle bg-bg-input text-[10px] text-text-tertiary">
                                            {skill.id}
                                        </span>
                                    </div>
                                    <p className="text-xs text-text-secondary leading-relaxed">{skill.description}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-text-tertiary">
                                <CheckCircle size={13} className="text-green-500" />
                                {skill.source === 'builtin' ? 'Built-in' : 'Local'}
                            </div>
                        </div>
                    </div>
                ))}

                {!loading && skills.length === 0 && (
                    <div className="bg-bg-card rounded-xl border border-border-subtle p-6 text-center">
                        <Sparkles size={20} className="mx-auto mb-2 text-text-tertiary" />
                        <p className="text-sm font-medium text-text-primary">No skills found</p>
                        <p className="text-xs text-text-secondary mt-1">Open the skills folder and add a folder with SKILL.md.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SkillsSettings;
