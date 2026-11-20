-- Development only: the app user may create Prisma's shadow database and la_test_* databases.
GRANT ALL PRIVILEGES ON *.* TO 'la'@'%';
FLUSH PRIVILEGES;
