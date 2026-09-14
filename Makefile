.PHONY: install lint test start

install:
	npm install

lint:
	npm run typecheck

test:
	npm test

start:
	npm start
