"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { changePassword, checkEmail } from "@/lib/actions";

function EyeIcon({ open }: { open: boolean }) {
    return open ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3l18 18" />
            <path d="M10.6 6.1A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a17.6 17.6 0 0 1-3.4 4.3" />
            <path d="M6.7 6.7C3.7 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.4 4.8-1.1" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </svg>
    );
}

type Stage = "email" | "password" | "done";

export default function Home() {
    const [stage, setStage] = useState<Stage>("email");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPwd, setShowPwd] = useState(false);
    const [showPwd2, setShowPwd2] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    function onSubmitEmail(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            const res = await checkEmail(email);
            if (!res.ok) {
                setError(res.error);
                return;
            }
            setEmail(res.email);
            setStage("password");
        });
    }

    function onSubmitPassword(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        if (password !== confirm) {
            setError("Las contraseñas no coinciden.");
            return;
        }
        startTransition(async () => {
            const res = await changePassword(email, password, confirm);
            if (!res.ok) {
                setError(res.error);
                return;
            }
            setInfo("Contraseña actualizada. Redirigiendo al webmail...");
            setStage("done");
            setTimeout(() => {
                window.location.href = res.redirect;
            }, 1200);
        });
    }

    // Shared input + button class fragments (Carbonio-like look).
    const inputCls =
        "w-full rounded-md border-0 bg-zinc-100 px-3 py-3 text-zinc-900 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[var(--brand)] disabled:opacity-50 transition";
    const primaryBtnCls =
        "w-full rounded-md bg-[var(--brand)] hover:bg-[var(--brand-hover)] disabled:bg-[var(--brand)]/50 disabled:cursor-not-allowed text-white font-semibold tracking-wide uppercase py-3 transition-colors shadow-sm";
    const secondaryBtnCls =
        "w-full rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-50 font-semibold tracking-wide uppercase py-3 transition-colors";

    return (
        <div className="flex flex-col md:flex-row flex-1 min-h-screen">
            {/* Left pane: login-style card */}
            <div className="w-full md:w-[440px] lg:w-[480px] bg-white flex flex-col px-8 py-10 md:px-12 md:py-14 shadow-xl z-10">
                <div className="flex items-center mb-12">
                    <Image
                        src="/tsj_logo.svg"
                        alt="Tribunal Supremo de Justicia"
                        width={300}
                        height={70}
                        priority
                        className="h-14 w-auto"
                    />
                </div>

                <div className="flex-1 flex flex-col justify-start">
                    <h1 className="text-xl font-semibold text-[var(--tsj-navy)] mb-1">
                        Cambio de contraseña
                    </h1>
                    <p className="text-sm text-zinc-500 mb-8">
                        Portal seguro para restablecer su contraseña institucional.
                    </p>

                    {/* Stepper indicator */}
                    <ol className="flex items-center gap-2 mb-6" aria-label="Pasos">
                        {(["email", "password", "done"] as Stage[]).map((s, i) => {
                            const active = stage === s;
                            const done =
                                (stage === "password" && s === "email") ||
                                (stage === "done" && s !== "done");
                            return (
                                <li key={s} className="flex items-center gap-2">
                                    <span
                                        className={
                                            "h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold " +
                                            (active
                                                ? "bg-[var(--brand)] text-white"
                                                : done
                                                    ? "bg-[var(--brand)]/20 text-[var(--brand)]"
                                                    : "bg-zinc-200 text-zinc-500")
                                        }
                                    >
                                        {done ? "✓" : i + 1}
                                    </span>
                                    {i < 2 && <span className="w-6 h-px bg-zinc-300" />}
                                </li>
                            );
                        })}
                    </ol>

                    {stage === "email" && (
                        <form onSubmit={onSubmitEmail} className="space-y-4">
                            <div>
                                <label htmlFor="email" className="block text-xs font-medium text-zinc-600 mb-1.5 uppercase tracking-wide">
                                    Correo electrónico
                                </label>
                                <input
                                    id="email"
                                    type="email"
                                    required
                                    autoFocus
                                    autoComplete="username"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="usuario@tsj.gob.ve"
                                    disabled={isPending}
                                    className={inputCls}
                                />
                            </div>
                            {error && (
                                <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                                    {error}
                                </p>
                            )}
                            <button type="submit" disabled={isPending} className={primaryBtnCls}>
                                {isPending ? "Verificando..." : "Continuar"}
                            </button>
                            <p className="text-xs text-zinc-500 pt-2 leading-relaxed">
                                Sólo cuentas marcadas para cambio obligatorio podrán
                                continuar. Si no recuerda su correo, contacte a soporte.
                            </p>
                        </form>
                    )}

                    {stage === "password" && (
                        <form onSubmit={onSubmitPassword} className="space-y-4">
                            <div className="text-sm text-zinc-600 -mt-2">
                                Cuenta:{" "}
                                <span className="font-medium text-[var(--tsj-navy)]">
                                    {email}
                                </span>
                            </div>

                            <div>
                                <label htmlFor="pwd" className="block text-xs font-medium text-zinc-600 mb-1.5 uppercase tracking-wide">
                                    Nueva contraseña
                                </label>
                                <div className="relative">
                                    <input
                                        id="pwd"
                                        type={showPwd ? "text" : "password"}
                                        required
                                        autoFocus
                                        minLength={8}
                                        autoComplete="new-password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        disabled={isPending}
                                        className={inputCls + " pr-11"}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPwd((s) => !s)}
                                        aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-500 hover:text-zinc-700"
                                    >
                                        <EyeIcon open={showPwd} />
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="pwd2" className="block text-xs font-medium text-zinc-600 mb-1.5 uppercase tracking-wide">
                                    Confirmar contraseña
                                </label>
                                <div className="relative">
                                    <input
                                        id="pwd2"
                                        type={showPwd2 ? "text" : "password"}
                                        required
                                        minLength={8}
                                        autoComplete="new-password"
                                        value={confirm}
                                        onChange={(e) => setConfirm(e.target.value)}
                                        disabled={isPending}
                                        className={inputCls + " pr-11"}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPwd2((s) => !s)}
                                        aria-label={showPwd2 ? "Ocultar contraseña" : "Mostrar contraseña"}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-500 hover:text-zinc-700"
                                    >
                                        <EyeIcon open={showPwd2} />
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                                    {error}
                                </p>
                            )}

                            <div className="grid grid-cols-2 gap-3 pt-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setStage("email");
                                        setPassword("");
                                        setConfirm("");
                                        setError(null);
                                    }}
                                    disabled={isPending}
                                    className={secondaryBtnCls}
                                >
                                    Atrás
                                </button>
                                <button type="submit" disabled={isPending} className={primaryBtnCls}>
                                    {isPending ? "Guardando..." : "Cambiar"}
                                </button>
                            </div>

                            <p className="text-xs text-zinc-500 pt-2 leading-relaxed">
                                La contraseña debe tener al menos 8 caracteres y cumplir
                                la política de seguridad del dominio.
                            </p>
                        </form>
                    )}

                    {stage === "done" && (
                        <div className="text-center space-y-4 py-6">
                            <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            </div>
                            <div className="text-lg font-semibold text-[var(--tsj-navy)]">¡Listo!</div>
                            <p className="text-sm text-zinc-600">{info}</p>
                        </div>
                    )}
                </div>

                <footer className="mt-10 pt-6 border-t border-zinc-100 text-xs text-zinc-500 space-y-1">
                    <p>
                        ¿Problemas para acceder? Contacte a la mesa de ayuda
                        institucional.
                    </p>
                    <p className="text-zinc-400">
                        Copyright © {new Date().getFullYear()} Tribunal Supremo de Justicia
                    </p>
                </footer>
            </div>

            {/* Right pane: decorative mesh background */}
            <div className="hidden md:block flex-1 tsj-mesh" aria-hidden="true" />
        </div>
    );
}



