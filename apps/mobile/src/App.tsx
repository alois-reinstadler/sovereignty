import { useEffect, useState, useSyncExternalStore } from "react";
import {
	Alert,
	AppState,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Switch,
	Text,
	TextInput,
	View,
} from "react-native";
import { VaultController } from "./controller";
import { nativeCrypto } from "./native-crypto";
import { nativeStore } from "./native-storage";
import { MobileVault, type VaultItem } from "./vault";

// Native values mirror Sovereignty's Astryx-themed web palette; no DOM components.
const colors = {
	background: "#0a0d0f",
	surface: "#121718",
	text: "#f2f5f3",
	secondary: "#99a3a0",
	border: "#303a38",
	danger: "#fca5a5",
};
function Action({
	title,
	onPress,
	disabled = false,
	danger = false,
}: {
	title: string;
	onPress: () => void;
	disabled?: boolean;
	danger?: boolean;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			testID={`action-${title.toLowerCase().replaceAll(" ", "-")}`}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			style={[styles.action, disabled && { opacity: 0.4 }]}
		>
			<Text style={[styles.actionText, danger && { color: colors.danger }]}>
				{title}
			</Text>
		</Pressable>
	);
}
function Field({
	label,
	value,
	onChange,
	secret = false,
	multiline = false,
	limit = 16384,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	secret?: boolean;
	multiline?: boolean;
	limit?: number;
}) {
	return (
		<View style={styles.field}>
			<Text style={styles.label}>{label}</Text>
			<TextInput
				accessibilityLabel={label}
				testID={label.toLowerCase().replaceAll(" ", "-")}
				value={value}
				onChangeText={onChange}
				secureTextEntry={secret}
				multiline={multiline}
				maxLength={limit}
				autoCorrect={false}
				autoCapitalize="none"
				autoComplete="off"
				textContentType="none"
				style={styles.input}
			/>
		</View>
	);
}
function Editor({
	controller,
	initial,
	isNew,
	done,
}: {
	controller: VaultController;
	initial: VaultItem;
	isNew: boolean;
	done: () => void;
}) {
	const state = useSyncExternalStore(controller.subscribe, controller.getState);
	const [draft, setDraft] = useState(initial);
	const [revealed, setRevealed] = useState(false);
	const update = (key: keyof VaultItem, value: string | boolean) =>
		setDraft((previous) => ({ ...previous, [key]: value }));
	return (
		<View style={styles.card}>
			<Text accessibilityRole="header" style={styles.heading}>
				{isNew ? "New login" : "Edit login"}
			</Text>
			<Field
				label="Title"
				value={draft.title}
				onChange={(value) => update("title", value)}
			/>
			<Field
				label="Username or email"
				value={draft.username}
				onChange={(value) => update("username", value)}
			/>
			<Field
				label="Password"
				value={draft.password}
				onChange={(value) => update("password", value)}
				secret={!revealed}
			/>
			<View style={styles.row}>
				<Action
					title={revealed ? "Hide password" : "Reveal password"}
					onPress={() => setRevealed((value) => !value)}
				/>
				<Action
					title="Generate password"
					onPress={() => update("password", controller.vault.generate())}
				/>
			</View>
			<Field
				label="Website"
				value={draft.website}
				onChange={(value) => update("website", value)}
			/>
			<Field
				label="Notes"
				value={draft.notes}
				onChange={(value) => update("notes", value)}
				multiline
			/>
			<View style={styles.row}>
				<Text style={styles.label}>Favourite</Text>
				<Switch
					accessibilityLabel="Favourite"
					value={draft.favorite}
					onValueChange={(value) => update("favorite", value)}
				/>
			</View>
			<Action
				title={state.busy ? "Saving encrypted login…" : "Save login"}
				disabled={state.busy || !draft.title.trim()}
				onPress={() => {
					void controller
						.save(
							{
								...draft,
								title: draft.title.trim(),
								updatedAt: new Date().toISOString(),
							},
							isNew,
						)
						.then((saved) => {
							if (saved) done();
						});
				}}
			/>
			<Action title="Cancel editing" disabled={state.busy} onPress={done} />
		</View>
	);
}
function Unlocked({ controller }: { controller: VaultController }) {
	const state = useSyncExternalStore(controller.subscribe, controller.getState);
	const [search, setSearch] = useState("");
	const [editing, setEditing] = useState<{
		item: VaultItem;
		isNew: boolean;
	} | null>(null);
	const query = search.toLocaleLowerCase("en");
	const items = state.items
		.filter((item) =>
			[item.title, item.username, item.website].some((value) =>
				value.toLocaleLowerCase("en").includes(query),
			),
		)
		.toSorted(
			(a, b) =>
				Number(b.favorite) - Number(a.favorite) ||
				a.title.localeCompare(b.title, "en"),
		);
	return (
		<>
			<Action title="Lock vault" onPress={() => controller.lock()} />
			{editing ? (
				<Editor
					key={editing.item.id}
					controller={controller}
					initial={editing.item}
					isNew={editing.isNew}
					done={() => setEditing(null)}
				/>
			) : (
				<>
					<Field
						label="Search logins"
						value={search}
						onChange={setSearch}
						limit={256}
					/>
					<Action
						title="Add login"
						disabled={state.busy}
						onPress={() => {
							const now = new Date().toISOString();
							setEditing({
								isNew: true,
								item: {
									id: controller.vault.id(),
									title: "",
									username: "",
									password: "",
									website: "",
									notes: "",
									favorite: false,
									createdAt: now,
									updatedAt: now,
								},
							});
						}}
					/>
					<Text style={styles.secondary}>
						{items.length} {items.length === 1 ? "login" : "logins"}
						{query ? " match your search" : " saved locally"}
					</Text>
					{items.map((item) => (
						<View key={item.id} style={styles.card}>
							<Text accessibilityRole="header" style={styles.heading}>
								{item.favorite ? "★ " : ""}
								{item.title}
							</Text>
							<Text style={styles.secondary}>
								{item.username || "No username"}
							</Text>
							<Text style={styles.secondary}>
								{item.website || "No website"}
							</Text>
							<View style={styles.row}>
								<Action
									title={`Edit ${item.title}`}
									disabled={state.busy}
									onPress={() => setEditing({ item, isNew: false })}
								/>
								<Action
									title={`Delete ${item.title}`}
									disabled={state.busy}
									danger
									onPress={() => {
										const remove = controller.prepareRemoval(item.id);
										Alert.alert(
											"Delete login?",
											"The next encrypted snapshot will no longer contain this login. Earlier encrypted snapshots remain on this device.",
											[
												{ text: "Cancel", style: "cancel" },
												{
													text: "Delete",
													style: "destructive",
													onPress: remove,
												},
											],
										);
									}}
								/>
							</View>
						</View>
					))}
				</>
			)}
		</>
	);
}
function VaultScreen({ controller }: { controller: VaultController }) {
	const state = useSyncExternalStore(controller.subscribe, controller.getState);
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	useEffect(() => {
		controller.setActive(AppState.currentState === "active");
		void controller.initialize();
		const subscription = AppState.addEventListener("change", (next) => {
			controller.setActive(next === "active");
			if (next !== "active") {
				setPassword("");
				setConfirmation("");
			}
		});
		return () => {
			subscription.remove();
			controller.lock();
		};
	}, [controller]);
	return (
		<KeyboardAvoidingView
			style={styles.screen}
			behavior={Platform.OS === "ios" ? "padding" : undefined}
		>
			<ScrollView
				contentContainerStyle={styles.content}
				keyboardShouldPersistTaps="handled"
			>
				<Text accessibilityRole="header" style={styles.title}>
					Sovereignty
				</Text>
				<Text style={styles.warning}>
					Unaudited development client. Use synthetic credentials only.
				</Text>
				<Text accessibilityLiveRegion="polite" style={styles.secondary}>
					{state.message}
				</Text>
				{state.unlocked ? (
					<Unlocked controller={controller} />
				) : (
					<View style={styles.card}>
						<Text accessibilityRole="header" style={styles.heading}>
							{state.hasVault ? "Unlock local vault" : "Create local vault"}
						</Text>
						<Text style={styles.secondary}>
							Your master password stays on this device. There is no password
							recovery.
						</Text>
						<Field
							label="Master password"
							value={password}
							onChange={setPassword}
							secret
							limit={1024}
						/>
						{!state.hasVault && (
							<Field
								label="Confirm master password"
								value={confirmation}
								onChange={setConfirmation}
								secret
								limit={1024}
							/>
						)}
						<Action
							title={
								state.busy
									? "Please wait…"
									: state.hasVault
										? "Unlock vault"
										: "Create encrypted vault"
							}
							disabled={
								!state.ready ||
								state.busy ||
								password.length < (state.hasVault ? 1 : 12) ||
								(!state.hasVault && password !== confirmation)
							}
							onPress={() => {
								const input = password;
								setPassword("");
								setConfirmation("");
								void controller.authenticate(input, !state.hasVault);
							}}
						/>
						{!state.hasVault && (
							<Text style={styles.secondary}>
								Use at least 12 characters and confirm the same password.
							</Text>
						)}
					</View>
				)}
				<Text style={styles.secondary}>
					Local storage only · No account or cloud sync
				</Text>
			</ScrollView>
		</KeyboardAvoidingView>
	);
}
export default function App() {
	const [runtime] = useState(() => {
		try {
			return {
				controller: new VaultController(
					new MobileVault(nativeCrypto()),
					nativeStore(),
				),
			};
		} catch {
			return { controller: null };
		}
	});
	if (!runtime.controller)
		return (
			<View style={styles.content}>
				<Text style={styles.title}>Sovereignty</Text>
				<Text>
					Native crypto or encrypted storage is unavailable. Install a native
					development build; Expo Go is unsupported.
				</Text>
			</View>
		);
	return <VaultScreen controller={runtime.controller} />;
}
const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.background },
	content: {
		paddingHorizontal: 24,
		paddingTop: 64,
		paddingBottom: 40,
		gap: 18,
	},
	title: { color: colors.text, fontSize: 30, fontWeight: "700" },
	heading: { color: colors.text, fontSize: 20, fontWeight: "600" },
	secondary: { color: colors.secondary, fontSize: 15, lineHeight: 22 },
	warning: { color: colors.danger, fontSize: 14, lineHeight: 21 },
	card: {
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: 12,
		padding: 16,
		gap: 14,
	},
	field: { gap: 6 },
	label: { color: colors.text, fontSize: 15, fontWeight: "500" },
	input: {
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: 8,
		padding: 12,
		minHeight: 48,
		fontSize: 16,
		color: colors.text,
		backgroundColor: colors.surface,
	},
	row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
	action: {
		minHeight: 48,
		justifyContent: "center",
		paddingVertical: 12,
		paddingHorizontal: 14,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: colors.border,
	},
	actionText: { color: colors.text, fontSize: 16, fontWeight: "600" },
});
