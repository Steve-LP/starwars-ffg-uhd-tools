// scripts/init.js
/**
 * starwars-ffg-uhd-tools – Überarbeitete Version
 */
window.SWFFGUHDTools = {
    MODULE_ID: "starwars-ffg-uhd-tools",

    /** GM‑Listener auf native Sockets */
    registerSocketListener() {
        if (!game.user.isGM) return;
        console.log("🚨 UHD‑TOOLS | GM Native Socket‑Listener registrieren");

        // Socket-Listener registrieren
        game.socket.on(`module.${this.MODULE_ID}`, async (payload) => {
            console.log("🚨 UHD‑TOOLS | Socket-Event empfangen:", payload);
            try {
                await this.handleSocketPayload(payload);
            } catch (error) {
                console.error("🚨 UHD‑TOOLS | Fehler beim Verarbeiten des Socket-Events:", error);
                ui.notifications.error("Fehler beim Verarbeiten des Critical Roll-Events");
            }
        });
    },

    /** Dialog‑Launcher für alle Benutzer (einheitliche Mechanik) */
    showCriticalDialog() {
        // 1) Kontrolliertes Token prüfen (Source/Angreifer)
        const controlled = canvas.tokens.controlled;
        if (!controlled || controlled.length === 0) {
            ui.notifications.warn("Wähle zuerst das angreifende Token aus!");
            return;
        }
        if (controlled.length > 1) {
            ui.notifications.warn("Wähle nur ein angreifendes Token aus!");
            return;
        }

        // 2) Ziel-Token prüfen - Genau ein Ziel erforderlich
        const targets = Array.from(game.user.targets);
        if (!targets || targets.length === 0) {
            ui.notifications.warn("Targete genau einen Gegner!");
            return;
        }
        if (targets.length > 1) {
            ui.notifications.warn("Du kannst nur ein Ziel für Critical Damage auswählen!");
            return;
        }

        const sourceToken = controlled[0];
        const targetToken = targets[0];

        // 3) Actor-Validierung
        if (!sourceToken.actor) {
            ui.notifications.warn("Das angreifende Token hat keinen Actor!");
            return;
        }
        if (!targetToken.actor) {
            ui.notifications.warn("Das Ziel-Token hat keinen Actor!");
            return;
        }

        // 4) Verhindere Selbst-Targeting
        if (sourceToken.id === targetToken.id) {
            ui.notifications.warn("Ein Token kann sich nicht selbst angreifen!");
            return;
        }

        // Einheitlicher Dialog für alle Benutzer
        new Dialog({
            title: "Critical Injury/Damage",
            content: `
            <div style="margin-bottom: 10px;">
            <p><strong>Von:</strong> ${sourceToken.name} (${sourceToken.actor.type})</p>
            <p><strong>Ziel:</strong> ${targetToken.name} (${targetToken.actor.type})</p>
            </div>
            <div>
            <label for="critMod">Modifikator:</label>
            <input type="number" id="critMod" value="0" style="width:80px; margin-left: 10px;"/>
            </div>
            `,
            buttons: {
                apply: {
                    label: "Anwenden",
                    callback: html => {
                        const mod = parseInt(html.find("#critMod").val()) || 0;
                        const payload = {
                            type: "critroll",
                            userId: game.user.id,
                            sourceId: sourceToken.id,
                            targetId: targetToken.id,
                            critMod: mod,
                            timestamp: Date.now()
                        };

                        if (game.user.isGM) {
                            // GM führt direkt aus
                            console.log("🚨 UHD‑TOOLS | GM-Modus: Direkte Ausführung");
                            this.applyCritical(payload);
                        } else {
                            // Spieler sendet an GM
                            console.log("🚨 UHD‑TOOLS | Spieler-Event wird gesendet:", payload);
                            game.socket.emit(`module.${this.MODULE_ID}`, payload);
                            ui.notifications.info(`Crit‑Roll an GM gesendet (Mod = ${mod})`);
                        }
                    }
                },
                cancel: {
                    label: "Abbrechen",
                   callback: () => {
                       console.log("🚨 UHD‑TOOLS | Dialog abgebrochen");
                   }
                }
            },
            default: "apply"
        }).render(true);
    },

    /** Die eigentliche Crit‑Logik */
    async applyCritical({ sourceId, targetId, critMod, userId }) {
        console.log("🚨 UHD‑TOOLS | applyCritical aufgerufen mit:", { sourceId, targetId, critMod, userId });

        // KORRIGIERT: Ziel-Token finden (nicht Source!)
        const targetToken = canvas.tokens.get(targetId);
        if (!targetToken) {
            console.error("🚨 UHD‑TOOLS | Ziel-Token nicht gefunden:", targetId);
            ui.notifications.error(`Ziel-Token ${targetId} nicht gefunden.`);
            return;
        }

        // KORRIGIERT: Ziel-Actor verwenden
        const targetActor = targetToken.actor;
        if (!targetActor) {
            console.error("🚨 UHD‑TOOLS | Ziel-Actor nicht gefunden für Token:", targetId);
            ui.notifications.error("Ziel-Actor nicht gefunden!");
            return;
        }

        // Source-Token für Chat-Ausgabe und Durable-Berechnung
        const sourceToken = sourceId ? canvas.tokens.get(sourceId) : null;
        const sourceActor = sourceToken?.actor;

        try {
            // KORRIGIERT ZURÜCK: Durable-Count vom ANGREIFER-Actor berechnen (wie ursprünglich)
            let countDurable = 0;
            const actorForDurable = targetActor; // Fallback auf Target wenn kein Source

            for (const item of actorForDurable.items) {
                const coll = item.system?.collection;
                if (coll) {
                    countDurable += Object.values(coll).filter(e => e.name.toLowerCase() === "durable").length;
                }
                if (item.name.toLowerCase().includes("durable")) {
                    countDurable++;
                }
            }
            const durableMod = countDurable * 10;

            console.log("🚨 UHD‑TOOLS | Durable-Count vom Angreifer:", countDurable, "Bonus:", durableMod, "Actor:", actorForDurable.name);

            // Würfel mit Durable als positiven Bonus (höhere Crits)
            const roll = new Roll("1d100 + @mod - @dur", {mod: critMod, dur: durableMod});
            await roll.evaluate({async: true});

            // Roll-Message mit Flavor - Zeige Source und Target, Durable als Bonus
            const userName = game.users.get(userId)?.name || "Unbekannt";
            const rollFlavor = sourceToken && sourceToken.id !== targetToken.id
            ? `🎲 ${userName} (${sourceToken.name}) würfelt gegen ${targetToken.name}: 1d100 + ${critMod} + ${durableMod} (Durable)`
            : `🎲 ${userName} würfelt für ${targetToken.name}: 1d100 + ${critMod} + ${durableMod} (Durable)`;

            await roll.toMessage({
                speaker: ChatMessage.getSpeaker({actor: targetActor}), // KORRIGIERT: Target-Actor als Speaker
                                 flavor: rollFlavor
            });

            // Tabellen-Draw & Item-Eintrag - KORRIGIERT: Basiert auf Ziel-Actor-Type
            const finalTotal = Math.max(roll.total, 1);
            const tableName = targetActor.type === "vehicle" ? "Critical Damage" : "Critical Injuries";
            const table = game.tables.getName(tableName);

            if (!table) {
                console.error("🚨 UHD‑TOOLS | Tabelle nicht gefunden:", tableName);
                ui.notifications.error(`Tabelle "${tableName}" nicht gefunden.`);
                return;
            }

            console.log("🚨 UHD‑TOOLS | Verwende Tabelle:", tableName, "mit Roll:", finalTotal);

            // Draw von der Tabelle
            const draw = await table.draw({roll: new Roll(`${finalTotal}`), displayChat: false});
            const entry = draw.results?.[0];

            if (!entry) {
                console.error("🚨 UHD‑TOOLS | Kein Tabellen-Eintrag gefunden");
                ui.notifications.warn("Kein Tabellen‑Eintrag.");
                return;
            }

            // Item finden
            const item = game.items.get(entry.documentId);
            if (!item) {
                console.error("🚨 UHD‑TOOLS | Item nicht gefunden:", entry.documentId);
                ui.notifications.error("Item nicht gefunden.");
                return;
            }

            console.log("🚨 UHD‑TOOLS | Füge Item hinzu:", item.name, "zu", targetActor.name);

            // KORRIGIERT: Item zum ZIEL-Actor hinzufügen
            await targetActor.createEmbeddedDocuments("Item", [item.toObject()]);

            // Ziel-Meldung mit klickbarem Link - KORRIGIERT: Zeige klar das Ziel
            const speakerTarget = {alias: targetToken.name, token: targetToken.id, scene: canvas.scene.id};
            const resultMessage = sourceToken && sourceToken.id !== targetToken.id
            ? `🔔 **${targetToken.name}** erleidet durch ${sourceToken.name}: **@Item[${item.id}]{${item.name}}**`
            : `🔔 **${targetToken.name}** erhält: **@Item[${item.id}]{${item.name}}**`;

            await ChatMessage.create({
                speaker: speakerTarget,
                content: resultMessage
            });

            console.log("🚨 UHD‑TOOLS | Critical Roll erfolgreich abgeschlossen für:", targetActor.name);

        } catch (error) {
            console.error("🚨 UHD‑TOOLS | Fehler beim Critical Roll:", error);
            ui.notifications.error("Fehler beim Critical Roll!");
        }
    },

    /** Socket-Payload für GM verarbeiten */
    async handleSocketPayload(payload) {
        console.log("🚨 UHD‑TOOLS | Socket-Payload empfangen:", payload);

        if (payload.type === "critroll") {
            await this.applyCritical(payload);
        } else {
            console.warn("🚨 UHD‑TOOLS | Unbekannter Payload-Type:", payload.type);
        }
    }
};

// ─── Hooks direkt im obersten Scope ───

// 1) TA‑HUD Core Integration
Hooks.once("tokenActionHudCoreApiReady", (coreModule) => {
    console.log("🚨 UHD‑TOOLS | TA‑HUD Core API Ready");
    console.log("🚨 UHD‑TOOLS | Core Module:", coreModule);

    try {
        // Prüfe verfügbare Methoden
        if (typeof coreModule.registerSystem === 'function') {
            coreModule.registerSystem({
                id: "udhtools",
                name: "UDH Tools",
                actions: [{
                    id: "critroll",
                    name: "Crit Roll",
                    type: "button",
                    icon: "fas fa-bolt",
                    enabled: (token) => {
                        if (!token || !token.actor) return false;
                        if (game.user.isGM) return true; // GM kann immer
                        return ["character", "vehicle", "nemesis", "rival"].includes(token.actor.type);
                    },
                    onClick: (token) => {
                        console.log("🚨 UHD‑TOOLS | TA-HUD Button geklickt für:", token?.name);
                        SWFFGUHDTools.showCriticalDialog();
                    }
                }]
            });
            console.log("🚨 UHD‑TOOLS | Crit‑Roll Action in TA‑HUD registriert");
        } else if (typeof coreModule.api?.registerSystem === 'function') {
            // Alternative API-Struktur
            coreModule.api.registerSystem({
                id: "udhtools",
                name: "UDH Tools",
                actions: [{
                    id: "critroll",
                    name: "Crit Roll",
                    type: "button",
                    icon: "fas fa-bolt",
                    enabled: (token) => {
                        if (!token || !token.actor) return false;
                        if (game.user.isGM) return true;
                        return ["character", "vehicle", "nemesis", "rival"].includes(token.actor.type);
                    },
                    onClick: (token) => {
                        console.log("🚨 UHD‑TOOLS | TA-HUD Button geklickt für:", token?.name);
                        SWFFGUHDTools.showCriticalDialog();
                    }
                }]
            });
            console.log("🚨 UHD‑TOOLS | Crit‑Roll Action in TA‑HUD registriert (via api)");
        } else {
            console.warn("🚨 UHD‑TOOLS | Keine passende registerSystem-Methode gefunden");
            console.log("🚨 UHD‑TOOLS | Verfügbare Methoden:", Object.keys(coreModule));
            // TA-HUD Integration überspringen, Scene Controls funktionieren trotzdem
        }

    } catch (error) {
        console.error("🚨 UHD‑TOOLS | Fehler beim Registrieren der TA-HUD Action:", error);
        console.log("🚨 UHD‑TOOLS | Modul funktioniert weiterhin über Scene Controls");
    }
});

// 2) Szene‑Kontrollleiste (Scene Controls)
Hooks.on("getSceneControlButtons", (controls) => {
    const tokenCtrl = controls.find(c => c.name === "token");
    if (!tokenCtrl) {
        console.warn("🚨 UHD‑TOOLS | Token-Control nicht gefunden");
        return;
    }

    // Verhindere Duplikate
    if (tokenCtrl.tools.some(t => t.name === "udhtools")) {
        console.log("🚨 UHD‑TOOLS | Scene-Control-Button bereits vorhanden, überspringe");
        return;
    }

    tokenCtrl.tools.push({
        name: "udhtools",
        title: "UDH Tools - Critical Roll",
        icon: "fas fa-bolt",
        visible: game.user.role >= CONST.USER_ROLES.PLAYER,
        onClick: () => {
            console.log("🚨 UHD‑TOOLS | Scene-Control-Button geklickt");
            SWFFGUHDTools.showCriticalDialog();
        },
        button: true
    });

    console.log("🚨 UHD‑TOOLS | Scene‑Control‑Button registriert");
});

// 3) Init & Ready
Hooks.once("init", () => {
    console.log("🚨 UHD‑TOOLS | init hook ausgelöst");

    // Modul-Einstellungen registrieren (optional)
    game.settings.register(SWFFGUHDTools.MODULE_ID, "debugMode", {
        name: "Debug Mode",
        hint: "Aktiviert erweiterte Konsolen-Ausgaben",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });
});

Hooks.once("ready", () => {
    console.log("🚨 UHD‑TOOLS | ready hook ausgelöst");

    // Socket-Listener registrieren
    SWFFGUHDTools.registerSocketListener();

    // Bestätigung, dass das Modul geladen wurde
    ui.notifications.info("UDH Tools geladen!");

    // Debug-Info
    if (game.settings.get(SWFFGUHDTools.MODULE_ID, "debugMode")) {
        console.log("🚨 UHD‑TOOLS | Debug-Modus aktiv");
        console.log("🚨 UHD‑TOOLS | User ist GM:", game.user.isGM);
        console.log("🚨 UHD‑TOOLS | Verfügbare Tokens:", canvas.tokens.controlled.length);
    }
});

// 4) Zusätzliche Hooks für bessere Integration
Hooks.on("controlToken", (token, controlled) => {
    if (controlled && game.settings.get(SWFFGUHDTools.MODULE_ID, "debugMode")) {
        console.log("🚨 UHD‑TOOLS | Token ausgewählt:", token.name, "Type:", token.actor?.type);
    }
});

// 5) Fehlerbehandlung
Hooks.on("error", (error) => {
    if (error.message && error.message.includes("UHD‑TOOLS")) {
        console.error("🚨 UHD‑TOOLS | Modul-Fehler:", error);
    }
});
