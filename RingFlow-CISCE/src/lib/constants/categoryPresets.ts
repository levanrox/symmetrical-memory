export type CategoryDefinitionInput = {
  id?: string;
  categoryName: string;
  eventType: "kumite" | "kata" | "team_kumite" | "team_kata";
  gender: "M" | "F" | "any";
  minAge?: number | null;
  maxAge?: number | null;
  minWeight?: number | null;
  maxWeight?: number | null;
  rules?: Record<string, any>;
};

// Standard Presets for Karate Tournaments
export const OFFICIAL_PRESETS: Record<string, CategoryDefinitionInput[]> = {
  CISCE_OFFICIAL: [
    // Sub-Junior / Under 14 Kumite Boys
    { categoryName: "U14_M_Below-35KG", eventType: "kumite", gender: "M", minAge: 11, maxAge: 13, minWeight: 0, maxWeight: 35 },
    { categoryName: "U14_M_35-40KG", eventType: "kumite", gender: "M", minAge: 11, maxAge: 13, minWeight: 35.01, maxWeight: 40 },
    { categoryName: "U14_M_40-45KG", eventType: "kumite", gender: "M", minAge: 11, maxAge: 13, minWeight: 40.01, maxWeight: 45 },
    { categoryName: "U14_M_45-50KG", eventType: "kumite", gender: "M", minAge: 11, maxAge: 13, minWeight: 45.01, maxWeight: 50 },
    { categoryName: "U14_M_Above-50KG", eventType: "kumite", gender: "M", minAge: 11, maxAge: 13, minWeight: 50.01, maxWeight: 100 },
    // Sub-Junior / Under 14 Kumite Girls
    { categoryName: "U14_F_Below-30KG", eventType: "kumite", gender: "F", minAge: 11, maxAge: 13, minWeight: 0, maxWeight: 30 },
    { categoryName: "U14_F_30-35KG", eventType: "kumite", gender: "F", minAge: 11, maxAge: 13, minWeight: 30.01, maxWeight: 35 },
    { categoryName: "U14_F_35-40KG", eventType: "kumite", gender: "F", minAge: 11, maxAge: 13, minWeight: 35.01, maxWeight: 40 },
    { categoryName: "U14_F_Above-40KG", eventType: "kumite", gender: "F", minAge: 11, maxAge: 13, minWeight: 40.01, maxWeight: 100 },
    // Sub-Junior Kata (Weight ignored)
    { categoryName: "U14_M_Kata", eventType: "kata", gender: "M", minAge: 11, maxAge: 13 },
    { categoryName: "U14_F_Kata", eventType: "kata", gender: "F", minAge: 11, maxAge: 13 },

    // Junior / Under 17 Kumite Boys
    { categoryName: "U17_M_Below-50KG", eventType: "kumite", gender: "M", minAge: 14, maxAge: 16, minWeight: 0, maxWeight: 50 },
    { categoryName: "U17_M_50-55KG", eventType: "kumite", gender: "M", minAge: 14, maxAge: 16, minWeight: 50.01, maxWeight: 55 },
    { categoryName: "U17_M_55-60KG", eventType: "kumite", gender: "M", minAge: 14, maxAge: 16, minWeight: 55.01, maxWeight: 60 },
    { categoryName: "U17_M_60-65KG", eventType: "kumite", gender: "M", minAge: 14, maxAge: 16, minWeight: 60.01, maxWeight: 65 },
    { categoryName: "U17_M_Above-65KG", eventType: "kumite", gender: "M", minAge: 14, maxAge: 16, minWeight: 65.01, maxWeight: 100 },
    // Junior / Under 17 Kumite Girls
    { categoryName: "U17_F_Below-45KG", eventType: "kumite", gender: "F", minAge: 14, maxAge: 16, minWeight: 0, maxWeight: 45 },
    { categoryName: "U17_F_45-50KG", eventType: "kumite", gender: "F", minAge: 14, maxAge: 16, minWeight: 45.01, maxWeight: 50 },
    { categoryName: "U17_F_50-55KG", eventType: "kumite", gender: "F", minAge: 14, maxAge: 16, minWeight: 50.01, maxWeight: 55 },
    { categoryName: "U17_F_Above-55KG", eventType: "kumite", gender: "F", minAge: 14, maxAge: 16, minWeight: 55.01, maxWeight: 100 },
    // Junior Kata
    { categoryName: "U17_M_Kata", eventType: "kata", gender: "M", minAge: 14, maxAge: 16 },
    { categoryName: "U17_F_Kata", eventType: "kata", gender: "F", minAge: 14, maxAge: 16 },

    // Senior / Under 19
    { categoryName: "U19_M_Below-60KG", eventType: "kumite", gender: "M", minAge: 17, maxAge: 19, minWeight: 0, maxWeight: 60 },
    { categoryName: "U19_M_60-67KG", eventType: "kumite", gender: "M", minAge: 17, maxAge: 19, minWeight: 60.01, maxWeight: 67 },
    { categoryName: "U19_M_Above-67KG", eventType: "kumite", gender: "M", minAge: 17, maxAge: 19, minWeight: 67.01, maxWeight: 100 },
    { categoryName: "U19_F_Below-50KG", eventType: "kumite", gender: "F", minAge: 17, maxAge: 19, minWeight: 0, maxWeight: 50 },
    { categoryName: "U19_F_50-55KG", eventType: "kumite", gender: "F", minAge: 17, maxAge: 19, minWeight: 50.01, maxWeight: 55 },
    { categoryName: "U19_F_Above-55KG", eventType: "kumite", gender: "F", minAge: 17, maxAge: 19, minWeight: 55.01, maxWeight: 100 },
    { categoryName: "U19_M_Kata", eventType: "kata", gender: "M", minAge: 17, maxAge: 19 },
    { categoryName: "U19_F_Kata", eventType: "kata", gender: "F", minAge: 17, maxAge: 19 },
  ],
};
