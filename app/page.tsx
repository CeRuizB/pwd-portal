"use client";

import { useState, useTransition } from "react";
import { changePassword, checkEmail } from "@/lib/actions";

type Stage = "email" | "password" | "done";

export default function Home() {
    const [stage, setStage] = useState<Stage>("email");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
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

    return (
        <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-zinc-950 p-4">
            <main className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-8">
                <header className="mb-6 text-center">
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Cambio de contraseña
                    </h1>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                        Portal de Carbonio Community
                    </p>
                </header>

                {stage === "email" && (
                    <form onSubmit={onSubmitEmail} className="space-y-4">
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
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
                                placeholder="usuario@dominio.com"
                                disabled={isPending}
                                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                            />
                        </div>
                        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                        <button
                            type="submit"
                            disabled={isPending}
                            className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 transition-colors"
                        >
                            {isPending ? "Verificando..." : "Continuar"}
                        </button>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center pt-2">
                            Sólo cuentas que requieran un cambio obligatorio podrán continuar.
                        </p>
                    </form>
                )}

                {stage === "password" && (
                    <form onSubmit={onSubmitPassword} className="space-y-4">
                        <div className="text-sm text-zinc-600 dark:text-zinc-400">
                            Cuenta: <span className="font-medium text-zinc-900 dark:text-zinc-50">{email}</span>
                        </div>
                        <div>
                            <label htmlFor="pwd" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                Nueva contraseña
                            </label>
                            <input
                                id="pwd"
                                type="password"
                                required
                                autoFocus
                                minLength={8}
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={isPending}
                                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                            />
                        </div>
                        <div>
                            <label htmlFor="pwd2" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                Confirmar contraseña
                            </label>
                            <input
                                id="pwd2"
                                type="password"
                                required
                                minLength={8}
                                autoComplete="new-password"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                disabled={isPending}
                                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                            />
                        </div>
                        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => { setStage("email"); setPassword(""); setConfirm(""); setError(null); }}
                                disabled={isPending}
                                className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium py-2.5 transition-colors"
                            >
                                Atrás
                            </button>
                            <button
                                type="submit"
                                disabled={isPending}
                                className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 transition-colors"
                            >
                                {isPending ? "Guardando..." : "Cambiar contraseña"}
                            </button>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 pt-2">
                            La contraseña debe tener al menos 8 caracteres y cumplir la política del dominio.
                        </p>
                    </form>
                )}

                {stage === "done" && (
                    <div className="text-center space-y-3 py-4">
                        <div className="text-green-600 dark:text-green-400 text-lg font-medium">¡Listo!</div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">{info}</p>
                    </div>
                )}
            </main>
            <footer className="mt-6 text-xs text-zinc-500 dark:text-zinc-500">
                Zextras Carbonio · Cambio de contraseña
            </footer>
        </div>
    );
}



