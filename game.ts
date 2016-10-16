/// <reference path="node_modules/definitely-typed/node/node.d.ts" />
/// <reference path="node_modules/definitely-typed/musicmetadata/musicmetadata.d.ts" />
/// <reference path="mp3-duration.d.ts" />

import * as sounds from './sounds';
import * as mm from 'musicmetadata';
import * as fs from 'fs';
import * as mp3Duration from 'mp3-duration';
import { Buzzer } from './buzzer';
import { WebGameUI } from './web_game_ui';
import { WebMasterUI } from './web_master_ui';
import { GameUI } from './game_ui';
import { QuestionLoader, QuestionList } from './question_loader';
import { Question, BlindQuestion, DeafQuestion } from './question';

export interface Team {
	name: string;
	id: string;
	active: boolean;
	flash: boolean;
	points: number;
}

export class Game {
	buzzer: Buzzer;
	gameUI: GameUI;
	masterUI: WebMasterUI;
	started: boolean;
	activatedTeams: number;
	step: number;
	teams: Array<Team>;
	mode: string;
	stopTeamActivation: Function;
	stopTeamActivationTimeout: any;
	questions: QuestionList;
	questionIndex: number;
	answers: Array<Array<number>>;
	answerWaitingForValidation: number;

	constructor(buzzer:Buzzer) {
		this.buzzer = buzzer;
		this.gameUI = null;
		this.masterUI = null;
		this.started = false;
		this.questions = null;
		this.answers = [];
		this.questionIndex = -1;
		this.answerWaitingForValidation = null;

		this.buzzer.ready(() => {
			var max = this.buzzer.controllersCount();
			// Make sur all buzzer are off
			for (var i=0; i < max; i++) {
				this.buzzer.lightOff(i);
			}
		});
	}

	start() {
		this.started = true;
		this.activatedTeams = 0;
		this.step = 0;
		this.initTeam();

		var directory = './questions';
		var ql = new QuestionLoader();
		this.questions = null;
		ql.load(directory, "random", (questions:QuestionList) => {
			this.questions = questions;
			this.questions.map((question: Question) => {
				if (question.type == 'blind') {
					loadMp3Informations(question, () => {});
				}
			});
		});
		this.modeStep();
	}

	initTeam() {
		var letters = 'ABCDEFGHIJKLMNOPQRST'.split('');
		this.teams = new Array(this.buzzer.controllersCount())
			.join()
			.split(',')
			.map((v, index) => {
				return {
					name: letters[index],
					id: letters[index].toLowerCase(),
					active: false,
					flash: false,
					points: 0
				}
			});
	}

	isStarted() {
		return this.started;
	}

	stop() {
		if (!this.isStarted()) {
			return;
		}
		// Do something
	}

	register(type: string, instance: any) {
		if (type == 'game') {
			this.gameUI = instance;
		} else if (type == 'master') {
			this.masterUI = instance;
		}

		if (!this.isStarted() && this.masterUI && this.gameUI) {
			this.start();
		} else if (this.isStarted()) {
			console.log('set currentStep')
			instance.setTeams(this.teams);
			instance.setStep(this.step);
		}
	}

	unregister(type: string) {
		if (type == 'game') {
			this.gameUI = null;
		} else if (type == 'master') {
			this.masterUI = null;
		}
	}

	setMode(mode: string) {
		this.mode = mode;
		console.log('set mode...');
		this.gameUI.setMode(this.mode);
		//this.activationStep();
	}

	addPoints(points:number) {
		var controllerIndex = this.answerWaitingForValidation;
		var team = this.teams[controllerIndex];

		team.points += points;
		team.active = false;
		team.flash = true;

		this.gameUI.updateTeam(team);
		this.masterUI.updateTeam(team);

		team.flash = false;

		this.nextQuestion();
	}


	//
	// Steps
	//
	modeStep() {
		this.step = 1;
		this.gameUI.setStep(1);
		this.masterUI.setStep(1);
	}

	activationStep() {
		this.step = 2;

		// Send the teams to uis
		this.gameUI.setTeams(this.teams);
		this.masterUI.setTeams(this.teams);

		// Go to step 2
		this.gameUI.setStep(2);
		this.masterUI.setStep(2);

		this.stopTeamActivation = this.buzzer.onPress((controllerIndex:number, buttonIndex:number) => {
			this.activateTeam(controllerIndex);
		});

		// Go to next step after a timeout
		this.stopTeamActivationTimeout = setTimeout(() => {
			this.quizzStep();
		}, 9000);
	}

	activateTeam(controllerIndex: number) {
		var team = this.teams[controllerIndex];

		console.log('activateTeam : ', controllerIndex, team);

		// make sure a team can only be activated once
		if (team.active) {
			return;
		}

		sounds.play('activate_team');

		// Count the activated teams
		this.activatedTeams++;

		// Light the buzzer on
		this.buzzer.lightOn(controllerIndex);

		// Activate the team
		team.active = true;
		team.flash = true;
		this.gameUI.activateTeam(team, true);
		this.masterUI.activateTeam(team, true);
		team.flash = false; // Just flash during activation

		// If all teams are activated, go to next step
		if (this.activatedTeams == this.buzzer.controllersCount()) {
			this.quizzStep();
		}
	}



	quizzStep() {

		if (this.activatedTeams <= 0) {
			this.step = 0;
			this.gameUI.setStep(0);
			this.masterUI.setStep(0);
			return;
		}

		// Stop the team activation
		this.stopTeamActivation();
		if (this.stopTeamActivationTimeout) {
			clearTimeout(this.stopTeamActivationTimeout);
		}

		// Turn off teams
		this.teams.forEach((team) => {
			team.active = false;
			this.gameUI.updateTeam(team);
			this.masterUI.updateTeam(team);
		});

		// Go to step 3 : showing questions
		this.step = 3;
		this.gameUI.setStep(3);
		this.masterUI.setStep(3);

		// Load the first question
		this.questionIndex = -1;
		this.nextQuestion();

		this.buzzer.onPress((controllerIndex:number, buttonIndex:number) => {
			if (this.questionIndex == -1 || this.answerWaitingForValidation != null) {
				return;
			}
			var qAnswers = this.answers[this.questionIndex];
			if (qAnswers[controllerIndex] == -1) {
				this.buzzed(controllerIndex);
			} else {
				console.log('already answered :(')
			}
		});
	}

	buzzed(controllerIndex: number) {
		var team = this.teams[controllerIndex];

		// Flash the team that has buzzed
		team.flash = true;
		team.active = true;
		this.gameUI.updateTeam(team);
		this.masterUI.updateTeam(team);
		team.flash = false;

		// Just pause the game
		this.answerWaitingForValidation = controllerIndex;
		this.gameUI.setAnswered(controllerIndex, true);
		this.masterUI.setAnswered(controllerIndex, true);
	}

	nextQuestion() {
		console.log('nextQuestion');
		this.questionIndex++;
		this.answers[this.questionIndex] = new Array(this.buzzer.controllersCount())
			.join()
			.split(',')
			.map(() => {
				return -1;
			});

		// Send the next question to uis
		var question:Question = this.questions.next();
		this.answerWaitingForValidation = null;
		this.gameUI.setQuestion(question);
		this.masterUI.setQuestion(question);

		
	}

}

function loadMp3Informations(question: Question, callback: Function) {
	var parser = mm(fs.createReadStream(question.file), (err, metadata) => {
		if (err) {
			console.log('errrrrr')
			throw err;
		}
		mp3Duration(question.file, (err, duration) => {
			if (err) {
				console.log('errrrrr')
				throw err;
			}

			(question as BlindQuestion).duration = metadata.duration;
			callback();
		});
	});	
}