// scripts/init.js
/**
 * starwars-ffg-uhd-tools – Vollständige SocketLib-Integration
 */

let socket;

Hooks.once("socketlib.ready", () => {
    // Modul bei socketlib anmelden
    socket = socketlib.registerModule("starwars-ffg-uhd-tools");
    // Funktions-Handler registrieren (auf allen Clients verfügbar machen)
    socket.register("applyCritical", applyCritical);
	socket.register("hello", showHelloMessage);
    console.log("🚨 UHD‑TOOLS | SocketLib: Module & Funktionen registriert");
});

Hooks.on("getSceneControlButtons", controls => {
    console.log("🚨 UHD‑TOOLS | Give me a button");
    const tokenCtrl = controls.find(c => c.name==="token");
    if (!tokenCtrl) return;
    if (!tokenCtrl.tools.some(t=>t.name==="critroll")) {
        tokenCtrl.tools.push({
            name: "critroll",
            visible: true,
            title: "Crit Roll",
            icon: "fas fa-bolt",
            onClick: () => showCritDialog(),
            button: true
        });
    }
});

Hooks.once("ready", () => {
    ui.notifications.info("UHD Tools geladen!");
    // Scene-Control-Button
});

Hooks.once("ready", async () => {
    console.log(`🚨 ready async called`);
    // Beispielaufrufe über Sockets:
    // 1) Nachricht an alle Benutzer senden
    socket.executeForEveryone("hello", game.user.name);
    // 2) Gleiches durch direkte Übergabe der Funktion
    socket.executeForEveryone(showHelloMessage, game.user.name);
    // 3) Addition auf einem GM-Client ausführen und Ergebnis abwarten
    //const result = await socket.executeAsGM("add", 5, 3);
    //console.log(`🚨 Der GM hat berechnet: ${result}`);
});

/** Zeigt den Crit‑Dialog für Spieler an */
function showCritDialog() {
    // 1) Kontrolliertes Token prüfen
    console.log(`🚨 showCritDialog soll passieren`);
    const controlled = canvas.tokens.controlled;
    if (controlled.length !== 1) {
        return ui.notifications.warn("Wähle genau ein angreifendes Token aus!");
    }
    // 2) Ziel prüfen
    const targets = Array.from(game.user.targets);
    if (targets.length !== 1) {
        return ui.notifications.warn("Targete genau einen Gegner!");
    }
    const attacker = controlled[0];
    const target = targets[0];
    if (attacker.id === target.id) {
        return ui.notifications.warn("Ein Token kann sich nicht selbst angreifen!");
    }

    // 3) Dialog rendern
    new Dialog({
        title: "Kritischer Trefferwurf",
        content: `
        <div><strong>Angreifer:</strong> ${attacker.name}</div>
        <div><strong>Ziel:</strong> ${target.name}</div>
        <div class="form-group">
        <label>Manueller Modifikator:</label>
        <input type="number" id="crit-mod" value="0" style="width:60px;"/>
        </div>`,
        buttons: {
            roll: {
                icon: '<i class="fas fa-dice"></i>',
                label: "Würfeln",
                callback: html => {
                    const mod = parseInt(html.find("#crit-mod").val()) || 0;
                    const payload = {
                        type: "critroll",
                        userId: game.user.id,
                        userName: game.user.name,
                        attackerId: attacker.id,
                        targetId: target.id,
                        manualMod: mod,
                        timestamp: Date.now()
                    };
                    // Wenn GM, direkt ausführen
                    if (game.user.isGM) {
                        applyCritical(payload);
                    } else {
                        // Spieler sendet an GM
                        socket.executeAsGM("applyCritical", payload);
                        ui.notifications.info(`Crit‑Roll an GM gesendet (Mod = ${mod})`);
                    }
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Abbrechen"
            }
        },
        default: "roll"
    }).render(true);
}

function showHelloMessage(userName) {
    console.log(`🚨 User ${userName} says hello!`);
}

/** GM‑Funktion: Crit anwenden */
async function applyCritical(data) {
    console.error("🚨 UHD‑TOOLS | applyCritical aufgerufen:", data);
    const { attackerId, targetId, userName, manualMod } = data;
    const attacker = canvas.tokens.get(attackerId);
    const target = canvas.tokens.get(targetId);

    if (!attacker || !target) {
        return ui.notifications.error("Angreifer- oder Ziel-Token nicht gefunden!");
    }
    const actor = target.actor;

    // 1) Automatischer Mod: +10 pro vorhandenem Crit
    const existing = actor.items.filter(i => ["criticalinjury","criticaldamage"].includes(i.type)).length;
    const autoMod = existing * 10;

    const targetToken = canvas.tokens.get(targetId);
    if (!targetToken) {
        console.warn("Target-Token nicht gefunden!");
        return;
    }


    const targetActor = targetToken.actor;

    // Durable‑Rang aus dem Talente‑Array
    const durableRank = targetActor.talentList.find(t => t.name === "Durable")?.rank ?? 0;
    console.log(`🚨 UHD‑TOOLS | ${durableRank} `);

    const durableMod = durableRank * 10;
    console.log(`🚨 UHD‑TOOLS | ${durableMod} `);


    // 3) Würfeln
    const roll = new Roll("1d100 + @man + @auto - @dur", {
        man: manualMod,
        auto: autoMod,
        dur: durableMod
    });
    await roll.evaluate({ async: true });
    const total = Math.max(roll.total, 1);

    // 4) Chatmeldung mit Hover-Wurf
    const speaker = ChatMessage.getSpeaker({ actor });
    const flavor = `🎲 ${userName} würfelt gegen ${target.name}: 1d100 + ${manualMod} + ${autoMod} - ${durableMod}`;
    await roll.toMessage({ speaker, flavor });

    // 5) Tabelle ziehen
    const tableName = actor.type==="vehicle" ? "Critical Damage" : "Critical Injuries";
    const table = game.tables.getName(tableName);
    if (!table) {
        return ui.notifications.error(`Tabelle "${tableName}" nicht gefunden!`);
    }
    const draw = await table.draw({ roll: new Roll(`${total}`), displayChat: false });
    const entry = draw.results[0];
    if (!entry) {
        return ui.notifications.warn("Kein Tabellen‑Eintrag gezogen.");
    }
    const item = game.items.get(entry.documentId);
    if (!item) {
        return ui.notifications.error("Item nicht gefunden.");
    }

    // 6) Injury/Damage hinzufügen
    await actor.createEmbeddedDocuments("Item", [item.toObject()]);

    // 7) Ergebnis-Chat
    const msg = `🔔 **${target.name}** erhält: **@Item[${item.id}]{${item.name}}**`;
    ChatMessage.create({ speaker: { alias: target.name, token: target.id, scene: canvas.scene.id }, content: msg });
    console.error("🚨 UHD‑TOOLS | Critical erfolgreich abgeschlossen");
}






/*
// Ready-Hook: Notification, TA-HUD & Scene Controls registrieren
Hooks.once("ready", () => {
    ui.notifications.info("UHD Tools geladen!");
    // Scene-Control-Button
    Hooks.on("getSceneControlButtons", controls => {
        const tokenCtrl = controls.find(c => c.name==="token");
        if (!tokenCtrl) return;
        if (!tokenCtrl.tools.some(t=>t.name==="critroll")) {
            tokenCtrl.tools.push({
                name: "critroll",
                title: "Crit Roll",
                icon: "fas fa-bolt",
                onClick: () => window.SWFFGUHDTools.showCritDialog(),
                                 button: true
            });
        }
    });
    // TA-HUD Integration
    Hooks.once("tokenActionHudCoreApiReady", core => {
        const actions=[{
            id:"critroll", name:"Crit Roll", type:"button", icon:"fas fa-bolt",
            enabled: t=> t?.actor && (game.user.isGM || ["character","vehicle","nemesis","rival"].includes(t.actor.type)),
               onClick: ()=>window.SWFFGUHDTools.showCritDialog()
        }];
        if (core.registerSystem) core.registerSystem({ id:"udhtools", name:"UHD Tools", actions });
        else if (core.api?.registerSystem) core.api.registerSystem({ id:"udhtools", name:"UHD Tools", actions });
    });
});
*/
