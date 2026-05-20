import { PI_AGENT_ROLES_ACTIVE_ROLE_EVENT, type RoleDisplayPayload, type ResolvedRole } from "./types.js";

export { PI_AGENT_ROLES_ACTIVE_ROLE_EVENT } from "./types.js";

export function emitActiveRoleDisplay(eventBus: { emit(event: string, payload: RoleDisplayPayload | null): void }, role: ResolvedRole): void {
	eventBus.emit(PI_AGENT_ROLES_ACTIVE_ROLE_EVENT, {
		name: role.name,
		label: role.label,
		color: role.displayColor,
	});
}

export function clearActiveRoleDisplay(eventBus: { emit(event: string, payload: RoleDisplayPayload | null): void }): void {
	eventBus.emit(PI_AGENT_ROLES_ACTIVE_ROLE_EVENT, null);
}

export function resolveRoleManagerLayout(width: number): "wide" | "compact" {
	return width >= 100 ? "wide" : "compact";
}

export function shouldShowFallbackWidget(options: {
	fancyEditorListenerCount: number;
	showWidgetWhenFancyEditorMissing: boolean;
}): boolean {
	return options.showWidgetWhenFancyEditorMissing && options.fancyEditorListenerCount === 0;
}
