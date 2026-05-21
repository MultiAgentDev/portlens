export interface AuthData {
    token: string;
    user: {
        id: string;
        email: string;
        plan: "free" | "pro";
        customSubdomain: string | null;
    };
}
export declare const AUTH_FILE: string;
export declare function readAuth(): AuthData | null;
export declare function writeAuth(data: AuthData): void;
export declare function deleteAuth(): void;
//# sourceMappingURL=authStore.d.ts.map