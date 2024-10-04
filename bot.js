const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, SlashCommandBuilder, Colors, ChannelType } = require('discord.js'); 
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const leoProfanity = require('leo-profanity'); // Import the leo-profanity package
const fs = require('fs');
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

// Store the channel and message IDs for role messages
let roleChannelId = null;
let timezoneMessageId = null;
let gameRoleMessageId = null;

client.commands = new Collection();

// Define and register slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('channel')
        .setDescription('Set the channel where roles will be posted')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('The channel to set for posting role messages')
                .setRequired(true)),
        
    new SlashCommandBuilder()
        .setName('roles')
        .setDescription('Assign your timezone role or custom game role')
        .addStringOption(option => 
            option.setName('custom_game')
                .setDescription('Custom game role (Optional, 17 characters max, 2 numbers max)')
                .setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('gamemessage')
        .setDescription('Post the game role selector in the set channel'),
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
                    color: Colors.Blue,
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

client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        const { commandName } = interaction;

        if (commandName === 'channel') {
            // Store the channel for role messages
            const channel = interaction.options.getChannel('channel');
            if (channel.type !== ChannelType.GuildText) {
                await interaction.reply({ content: 'Please select a text channel.', ephemeral: true });
                return;
            }
            roleChannelId = channel.id;

            // Post the timezone and game role messages in the designated channel
            await postRoleMessages(channel);
            await interaction.reply({ content: `Roles will be posted in ${channel}.`, ephemeral: true });

        } else if (commandName === 'roles') {
            const member = interaction.member;
            const guild = interaction.guild;

            const customGame = interaction.options.getString('custom_game') || '';

            // Profanity check for custom game roles
            if (customGame && leoProfanity.check(customGame)) {
                await interaction.reply({ content: ':warning: Please refrain from using inappropriate language.', ephemeral: true });
                return;
            }

            // Ensure timezone roles are created
            await checkOrCreateRoles(guild);

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

            // Handle custom game role creation if provided
            if (customGame) {
                if (customGame.length > 17 || (customGame.match(/\d/g) || []).length > 2) {
                    await interaction.reply({ content: 'Custom game role must be 17 characters max and no more than 2 numbers.', ephemeral: true });
                    return;
                }

                // Create custom game role if it doesn't exist
                let customRole = guild.roles.cache.find(r => r.name === customGame);
                if (!customRole) {
                    customRole = await guild.roles.create({
                        name: customGame,
                        color: Colors.Green,
                        reason: 'Custom game role created by user.'
                    });
                }

                await member.roles.add(customRole);
                await interaction.followUp({ content: `Custom role **${customGame}** has been created and assigned to you!`, ephemeral: true });
            }
        } else if (commandName === 'gamemessage') {
            const channel = client.channels.cache.get(roleChannelId);
            if (!channel) {
                await interaction.reply({ content: 'Role channel is not set. Use /channel to set a channel first.', ephemeral: true });
                return;
            }

            // Post the game role message
            await postGameRoleMessage(channel);
            await interaction.reply({ content: 'Game role message posted.', ephemeral: true });
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
                await interaction.reply({ content: `You have been assigned the ${timezone} role.`, ephemeral: true });
            }
        }
    }

    if (interaction.isSelectMenu()) {
        const { customId, values, member } = interaction;

        if (customId === 'select_games') {
            for (const value of values) {
                // Assign the selected game roles
                const gameRoleId = roleMap[value];
                await member.roles.add(gameRoleId);
            }
            await interaction.reply({ content: `Game roles added successfully!`, ephemeral: true });
        }
    }
});

// Function to post the role messages in the set channel
async function postRoleMessages(channel) {
    const timezoneEmbed = new EmbedBuilder()
        .setTitle('Timezone Role Selector')
        .setDescription('Please choose your timezone role below.')
        .setColor(Colors.Blue);

    const timezoneButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('role_EST').setLabel('EST').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('role_PST').setLabel('PST').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('role_CST').setLabel('CST').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('role_MST').setLabel('MST').setStyle(ButtonStyle.Primary)
        );

    const timezoneMessage = await channel.send({ embeds: [timezoneEmbed], components: [timezoneButtons] });
    timezoneMessageId = timezoneMessage.id;

    await postGameRoleMessage(channel);
}

// Function to post the game role selector message
async function postGameRoleMessage(channel) {
    const gameRoleEmbed = new EmbedBuilder()
        .setTitle('Game Role Selector')
        .setDescription('Select your favorite games below, or create a custom game role with `/roles`.');

    const gameRoles = new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_games')
                .setPlaceholder('Select game roles')
                .addOptions([
                    { label: 'Minecraft', value: 'minecraft' },
                    { label: 'League of Legends', value: 'league' },
                    { label: 'Valorant', value: 'valorant' }
                ])
        );

    const gameRoleMessage = await channel.send({ embeds: [gameRoleEmbed], components: [gameRoles] });
    gameRoleMessageId = gameRoleMessage.id;
}

// Auto-check and re-create the messages if missing every 10 hours
setInterval(async () => {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    const channel = client.channels.cache.get(roleChannelId);

    if (guild && channel) {
        // Check for timezone and game role messages
        if (!await channel.messages.fetch(timezoneMessageId)) {
            await postRoleMessages(channel);
        }
        if (!await channel.messages.fetch(gameRoleMessageId)) {
            await postGameRoleMessage(channel);
        }
    }
}, 10 * 60 * 60 * 1000); // Every 10 hours

// Initialize the bot
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const guild = client.guilds.cache.get(process.env.GUILD_ID); 
    if (guild) {
        await checkOrCreateRoles(guild); // Check and create roles if necessary
    }

    // Register commands globally
    await registerCommands();
});

client.login(process.env.DISCORD_TOKEN);
