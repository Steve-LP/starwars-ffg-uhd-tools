// Name des Moduls: starwars-ffg-uhd-tools
// init.js – Initialisierung und Hauptskript
// Dieses Skript implementiert den "Kritischer Trefferwurf" (Crit Roll) für das Star Wars FFG UHD Tools Modul.
// Es beinhaltet einen Dialog zur Modifikator-Eingabe, SocketLib-Kommunikation, TA-HUD Integration,
// einen Button in der Szenen-Leiste sowie die Roll-Logik gemäß den Regeln.

// Stelle sicher, dass SocketLib verfügbar ist und registriere das Modul.
Hooks.once("socketlib.ready", () => {
    // Überprüfen, ob das Modul korrekt geladen wurde
    console.log("[SWFFGUHDTools] SocketLib erkannt, Modul registriere...");
    // Registrierung bei SocketLib mit dem Modulnamen wie in module.json
    window.SWFFGUHDTools.socket = socketlib.registerModule("starwars-ffg-uhd-tools");
    // Registrierung der Crit Roll Funktion, die auf dem GM-Client ausgeführt wird
    window.SWFFGUHDTools.socket.register("critRoll", window.SWFFGUHDTools._receiveCritRoll);
});

window.SWFFGUHDTools = {
    socket: null,  // SocketLib-Instanz

    // Funktion zum Öffnen des Dialogs für einen kritischen Trefferwurf
    showCritDialog: function() {
        // Überprüfe, ob SocketLib aktiv ist
        if (!window.socketlib || !window.SWFFGUHDTools.socket) {
            ui.notifications.error("SWFFG UHD Tools benötigt das SocketLib-Modul.", {permanent: false});
            console.error("[SWFFGUHDTools] SocketLib nicht gefunden!");
            return;
        }
        // Dialoginhalt (HTML) mit Eingabefeld für Modifikator
        let content = `<p>Geben Sie einen Modifikator für den kritischen Trefferwurf ein:</p>
        <div class="form-group">
        <label>Modifikator:</label>
        <input type="number" id="crit-mod" name="crit-mod" value="0"/>
        </div>`;
        // Erzeuge und zeige Dialog
        new Dialog({
            title: "Kritischer Trefferwurf",
            content: content,
            buttons: {
                roll: {
                    icon: '<i class="fas fa-dice-d20"></i>',
                    label: "Würfeln",
                    callback: html => {
                        // Lese den Modifikator aus dem Eingabefeld
                        const mod = parseInt(html.find('input[name="crit-mod"]').val()) || 0;
                        // Starte den Crit Roll
                        window.SWFFGUHDTools._sendCritRoll(mod);
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Abbrechen",
                    callback: () => {
                        console.log("[SWFFGUHDTools] Kritischer Trefferwurf abgebrochen.");
                    }
                }
            },
            default: "roll"
        }).render(true);
    },

    // Methode, die vom Button/Kommando aufgerufen wird, um Crit-Roll an GM zu senden
    _sendCritRoll: async function(userMod) {
        // Bestimme angreifendes Token (kontrolliert) und Ziel-Token (exakt eines)
        const controlled = canvas.tokens.controlled;
        const targets = Array.from(game.user.targets);
        // Fehlerbehandlung: genau ein Ziel muss markiert sein
        if (targets.length !== 1) {
            ui.notifications.error("Bitte ziele genau ein anderes Token an.", {permanent: false});
            console.warn("[SWFFGUHDTools] Ungültige Zielanzahl:", targets.length);
            return;
        }
        // Mindestens ein kontrolliertes Token (Angreifer) muss existieren
        if (controlled.length < 1) {
            ui.notifications.error("Kein eigenes Token ausgewählt!", {permanent: false});
            console.warn("[SWFFGUHDTools] Kein kontrolliertes Token gefunden!");
            return;
        }
        // Angreifer-Token und Ziel-Token
        const attackerToken = controlled[0];
        const targetToken = targets[0];
        // Sende Daten über SocketLib an GM
        try {
            await window.SWFFGUHDTools.socket.executeAsGM("critRoll", {
                attackerId: attackerToken.id,
                targetId: targetToken.id,
                userId: game.user.id,
                userName: game.user.name,
                mod: userMod
            });
            console.log("[SWFFGUHDTools] Kritischer Trefferwurf gesendet an GM:", {
                attacker: attackerToken.id, target: targetToken.id, mod: userMod
            });
        } catch (error) {
            // Wenn kein GM verfügbar oder Fehler
            ui.notifications.error("Fehler beim Senden des Crit-Rolls. Ist ein GM online?", {permanent: false});
            console.error("[SWFFGUHDTools] Fehler bei SocketLib.executeAsGM:", error);
        }
    },

    // Funktion, die vom GM ausgeführt wird, wenn ein Crit-Roll hereinkommt
    _receiveCritRoll: async function(data) {
        // Datenstruktur: {attackerId, targetId, userId, userName, mod}
        console.log("[SWFFGUHDTools] Crit-Roll erhalten:", data);
        // Finde Token-Objekte anhand der IDs
        const attackerToken = canvas.tokens.get(data.attackerId);
        const targetToken = canvas.tokens.get(data.targetId);
        if (!attackerToken || !targetToken) {
            console.error("[SWFFGUHDTools] Angreifer- oder Ziel-Token nicht gefunden!");
            return;
        }
        // Berechne vorhandene Krits und Durable
        const critCount = window.SWFFGUHDTools.countExistingCrits(targetToken);
        const durableRank = window.SWFFGUHDTools.getDurableRank(targetToken);
        // Automatischer Modifikator: +10 pro vorhandenem Krit
        let autoBonus = critCount * 10;
        // Durable reduziert den Effekt: -10 pro Rang
        let durablePenalty = durableRank * 10;
        // Berechne Gesamtergebnis: d100 + (ManuellerMod + autoBonus - durablePenalty)
        let rollFormula = `1d100 + (${data.mod} + ${autoBonus} - ${durablePenalty})`;
        const roll = new Roll(rollFormula).roll({async: false});
        const total = roll.total;
        console.log(`[SWFFGUHDTools] Würfelergebnis (inkl. Modifikatoren): ${total}`);
        // Ergebnisse zusammenstellen (Chat-Message)
        let chatContent = `<b>${data.userName} führt einen kritischen Trefferwurf gegen ${targetToken.name} durch!</b><br>`;
        chatContent += `Würfelergebnis: <b>${total}</b> `;
        chatContent += `(Modifikatoren: ${data.mod} + ${autoBonus} (vorh. Krit) - ${durablePenalty} (Durable))<br>`;
        // Verursachtes Item bzw. kritischen Zustand ermitteln (Platzhalter, da Implementierung je nach Regelwerk variiert)
        // Hier könnte man z.B. über eine Rolltabelle oder vordefinierte Gegenstände gehen.
        // Für dieses Beispiel fügen wir einfach einen Platzhalter-Text ein.
        chatContent += `<i>Infizierter kritischer Zustand: __Hier Item einsetzen__</i>`;
        // Chat-Nachricht erstellen (als öffentlicher Beitrag)
        ChatMessage.create({content: chatContent});
        console.log("[SWFFGUHDTools] Chat-Eintrag erstellt für kritischen Trefferwurf.");
        // Aktualisiere Anzahl der bestehenden Krits auf dem Ziel (Flag)
        await targetToken.actor.setFlag("starwars-ffg-uhd-tools", "critCount",
                                        critCount + 1);
    },

    // Hilfsfunktion: Zähle vorhandene Krit-Treffer auf einem Token (über Flag oder Effekte)
    // Hier: Verwende ein Actor-Flag als Zähler.
    countExistingCrits: function(token) {
        if (!token.actor) return 0;
        const stored = token.actor.getFlag("starwars-ffg-uhd-tools", "critCount");
        return Number(stored) || 0;
    },

    // Hilfsfunktion: Ermittle den Rang des Talents "Durable" auf dem Ziel
    getDurableRank: function(token) {
        if (!token.actor) return 0;
        // Versuche, das Talent "Durable" bei den Items des Actors zu finden
        const durableItem = token.actor.items.find(i => i.name === "Durable");
        if (!durableItem) return 0;
        // Annahme: Das Talent hat eine Eigenschaft data.data.ranks oder data.data.rank
        // Je nach System (Genesys/FFG) könnte dies variieren; wir versuchen beides.
        const data = durableItem.data.data;
        const rank = data.ranks ?? data.rank ?? 0;
        return Number(rank);
    },

    // Einrichtung des SceneControl-Buttons
    setupSceneControl: function(controls) {
        // Definiere Werkzeuge für dieses Modul (hier nur ein Tool: Crit Roll)
        const tools = [
            {
                name: "critRoll",
                title: "Kritischer Trefferwurf",
                icon: "fas fa-bolt",
                // Bei Klick Dialog öffnen
                onClick: () => { window.SWFFGUHDTools.showCritDialog(); },
                button: true
            }
        ];
        // Füge einen neuen Abschnitt "UHD Tools" in der Symbolleiste hinzu
        controls.push({
            name: "uhd-tools",
            title: "UHD Tools",
            icon: "fas fa-tools",
            layer: "token",
            tools: tools,
            visible: true
            // Optional: Reihenfolge (0 = zuerst, 100 = zuletzt)
            // order: 50
        });
    },

    // (Optionale) Integration in Token Action HUD (TA-HUD Core)
    setupTokenActionHud: function() {
        // Prüfe, ob Token Action HUD Core geladen ist
        const tahCore = game.modules.get("token-action-hud-core")?.active;
        if (!tahCore) {
            console.warn("[SWFFGUHDTools] Token Action HUD nicht gefunden oder nicht aktiv.");
            return;
        }
        // Token Action HUD Core Integration (Registerung des SystemManagers)
        Hooks.once('tokenActionHudCoreApiReady', (coreModule) => {
            console.log("[SWFFGUHDTools] Token Action HUD Core API bereit.");
            // Definiere eine minimale SystemManager-Klasse (TA-HUD erfordert diese Struktur)
            class UHDSystemManager extends coreModule.api.SystemManager {
                static getActionHandler() { return null; }
                static getAvailableRollHandlers() { return []; }
                static getRollHandler() { return null; }
                static registerDefaults() {
                    // Keine vorgefertigten Layouts oder Gruppen, nur integrierte Crit-Funktion
                    return {layout: [], groups: []};
                }
            }
            const module = game.modules.get("starwars-ffg-uhd-tools");
            module.api = {
                requiredCoreModuleVersion: "2.0.0",
                SystemManager: UHDSystemManager
            };
            Hooks.call('tokenActionHudSystemReady', module);
            console.log("[SWFFGUHDTools] TA-HUD SystemManager registriert.");
        });
    }
};

// Beim Laden des Canvas: Szene-Kontrollbuttons hinzufügen
Hooks.on("getSceneControlButtons", (controls) => {
    window.SWFFGUHDTools.setupSceneControl(controls);
});

// Beim Fertigstellen des Setups: Token Action HUD Integration aufsetzen
Hooks.once("ready", () => {
    // Überprüfe SocketLib
    if (!game.modules.get("socketlib")?.active) {
        ui.notifications.error("SWFFG UHD Tools benötigt das SocketLib-Modul!");
        console.error("[SWFFGUHDTools] SocketLib-Modul ist nicht aktiv!");
    }
    // TA-HUD Integration versuchen
    window.SWFFGUHDTools.setupTokenActionHud();
    console.log("[SWFFGUHDTools] Modul bereit.");
});
