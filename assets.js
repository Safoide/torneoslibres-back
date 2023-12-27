const errorMessages = {
    team_wrongId: 'No se encontro un equipo con el id especificado',
    tor_wrongId: 'No se encontro un torneo con el id especificado',
    match_wrongId: 'No se encontro un partido con el id especificado',
    player_wrongId: 'No se encontro un jugador con el id especificado',

    noMatches_team: 'No se encontraron partidos para el equipo especificado',
    noMatches_tor: 'No se encontraron partidos para el torneo especificado',

    wrongData: 'Ocurrio un error al enviar los datos',
}

const formatId = (word, length) => {
    if(length > 9) return `${word}-${length}`

    return `${word}-0${length}`
}

const byId = (elementId) => {
    return (element) => element.id === elementId;
}

export { errorMessages, formatId, byId };