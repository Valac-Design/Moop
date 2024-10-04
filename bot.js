const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, SlashCommandBuilder, Colors } = require('discord.js'); 
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const fs = require('fs');
const path = require('path');
const leoProfanity = require('leo-profanity'); // Import the leo-profanity package
require('dotenv').config();

// Initialize the profanity filter
leoProfanity.loadDictionary(); // Load default profanity dictionary

// Initialize the Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences, // Required to detect user activity
        GatewayIntentBits.GuildVoiceStates // Required to detect voice channel changes
    ],
});

client.commands = new Collection();

// Define and register slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('vc')
        .setDescription('Join a voice channel and tag users')
        .addStringOption(option =>
            option.setName('game')
                .setDescription('The game you want to play')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('roles')
        .setDescription('Assign your timezone role'),
];

// Role mapping - this will store timezone roles and IDs
let roleMap = {
    EST: null,
    PST: null,
    CST: null,
    MST: null
};

// Function to check if roles exist, and create them if they don't
async function checkOrCreateRoles(guild) {
    for (const [timezone, roleId] of Object.entries(roleMap)) {
        if (!roleId || !guild.roles.cache.has(roleId)) {
            let role = guild.roles.cache.find(r => r.name === timezone);
            if (!role) {
                role = await guild.roles.create({
                    name: timezone,
                    color: Colors.Blue, // Use the correct color constant
                    reason: `Created ${timezone} role as it was not found.`,
                });
            }
            roleMap[timezone] = role.id;
        }
    }
}

// Register slash commands with Discord
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
    try {
        console.log('Started refreshing application (/) commands globally.');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands.map(command => command.toJSON()) }
        );

        console.log('Successfully reloaded application (/) commands globally.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Command handler
client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        const { commandName } = interaction;

        if (commandName === 'vc') {
            const member = interaction.member;
            const channel = member.voice.channel;

            if (!channel) {
                await interaction.reply({ content: `:warning: You are not in a voice channel!`, ephemeral: true });
                return;
            }

            const gameName = interaction.options.getString('game') || '';

            // Profanity check
            if (leoProfanity.check(gameName)) {
                await interaction.reply({ content: ':warning: Please refrain from using inappropriate language.', ephemeral: true });
                return;
            }

            let titleText = `${member.user.username} in ${channel.name}`;
            let descriptionText = `User is in voice channel ${channel.name}`;
            if (gameName) {
                descriptionText += ` and wants to play **${gameName}**`;
            }

            const embed = new EmbedBuilder()
                .setColor(Colors.Blue) // Use the correct color constant here as well
                .setTitle(titleText)
                .setDescription(descriptionText)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setTimestamp()
                .setFooter({
                    text: `Summoned by ${member.user.username}`,
                    iconURL: member.user.displayAvatarURL({ dynamic: true })
                });

            await interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'roles') {
            const timezoneButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('role_EST').setLabel('EST').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('role_PST').setLabel('PST').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('role_CST').setLabel('CST').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('role_MST').setLabel('MST').setStyle(ButtonStyle.Primary)
                );

            await interaction.reply({
                content: 'Please choose your timezone:',
                components: [timezoneButtons],
                ephemeral: true
            });
        }
    }

    if (interaction.isButton()) {
        const { customId, member, guild } = interaction;

        if (customId.startsWith('role_')) {
            const timezone = customId.split('_')[1];
            const roleId = roleMap[timezone];

            if (member.roles.cache.has(roleId)) {
                await interaction.reply({ content: `You already have the ${timezone} role.`, ephemeral: true });
            } else {
                await member.roles.add(roleId);

                // Now prompt for additional roles (like a game role)
                const gameRoles = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`select_games`)
                            .setPlaceholder('Select additional game roles (optional)')
                            .addOptions([
                                { label: 'Minecraft', value: 'minecraft' },
                                { label: 'League of Legends', value: 'league' },
                                { label: 'Valorant', value: 'valorant' }
                            ])
                    );

                await interaction.reply({
                    content: `You have been assigned the ${timezone} role. Please choose any additional game roles (optional):`,
                    components: [gameRoles],
                    ephemeral: true
                });
            }
        }
    }

    if (interaction.isSelectMenu()) {
        const { customId, values, member } = interaction;

        if (customId === 'select_games') {
            for (const value of values) {
                // Assign the selected game roles (You can use a similar roleMap for game roles)
                const gameRoleId = roleMap[value]; // You can use a similar roleMap for game roles
                await member.roles.add(gameRoleId);
            }
            await interaction.reply({ content: `Game roles added successfully!`, ephemeral: true });
        }
    }
});

// Initialize the bot
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const guild = client.guilds.cache.get(process.env.GUILD_ID); // Make sure to set GUILD_ID in .env
    if (guild) {
        await checkOrCreateRoles(guild); // Check and create roles if necessary
    }

    // Register commands globally
    await registerCommands();
});

client.login(process.env.DISCORD_TOKEN);
